import { test, expect, type Page, type Browser } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { BASE_URL, OUTPUT_DIR, readCredentials } from "./guards";

// TASK-020 visual capture against the 14 original references (BR-1, BR-22, BR-30).
// Signs in once through the real sign-in form with the owner's test account
// (runtime env vars). Captures screenshots to the git-ignored output directory
// and writes geometry only (no page text, names or ids) to a JSON report.
//
// Widths: 320 and 360 (phone), 375, 768 (tablet), 1024 and 1280 (desktop). The 640 px viewport is a
// reflow proxy for 200 % zoom on a 1280 px desktop (CSS px at 200 % = 640 px).
// Themes: "lys" (light) and "mork" (dark) through the stored theme choice.

const WIDTHS = [320, 360, 375, 768, 1024, 1280] as const;
const ZOOM_WIDTH = 640;
const THEMES = ["lys", "mork"] as const;
const DIR = `${OUTPUT_DIR}visual/`;

type Route = { ref: string; name: string; signedIn: boolean; path: string; template?: string };
type Shot = {
  ref: string;
  viewport: number;
  theme: string;
  url: string;
  status: "captured" | "not_verified" | "not_found" | "error";
  horizontalScroll?: boolean;
  scrollWidth?: number;
  clientWidth?: number;
  listHeightPx?: number | null;
  /** true when no loading text remained before the screenshot (TASK-026); false = captured while still loading. */
  ready?: boolean;
  note?: string;
};

const report: Shot[] = [];

async function signIn(page: Page): Promise<void> {
  const creds = readCredentials();
  if (!creds.ok) throw new Error(creds.message);
  await page.goto(`${BASE_URL}/sign-in`);
  await page.getByLabel("E-postadresse").fill(creds.email);
  await page.getByLabel("Passord").fill(creds.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  // Poll the location: the post-sign-in navigation is client-side and waitForURL missed it intermittently.
  await page.waitForFunction(() => !window.location.pathname.startsWith("/sign-in"), undefined, {
    timeout: 60_000,
    polling: 250,
  });
}

/** First same-origin link whose href starts with the given prefix; returns its path or null. */
async function firstHref(page: Page, prefix: string, excludeSuffixes: string[] = []): Promise<string | null> {
  // The lists load from live reads: wait (bounded) for at least one matching link before reading hrefs (TASK-026).
  await page
    .locator(`a[href^="${prefix}"]`)
    .first()
    .waitFor({ state: "attached", timeout: 20_000 })
    .catch(() => undefined);
  // A client-side navigation can destroy the execution context mid-read: wait for the page and retry that read only.
  let hrefs: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    try {
      hrefs = await page.locator(`a[href^="${prefix}"]`).evaluateAll((els) =>
        els.map((el) => el.getAttribute("href") ?? ""),
      );
      break;
    } catch (error) {
      if (attempt === 2 || !(error instanceof Error) || !error.message.includes("Execution context was destroyed")) throw error;
    }
  }
  const found = hrefs.find((href) => href.length > prefix.length && !excludeSuffixes.some((s) => href.endsWith(s)));
  return found ?? null;
}

async function measure(page: Page): Promise<{ horizontalScroll: boolean; scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return { horizontalScroll: doc.scrollWidth > doc.clientWidth, scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
}

/**
 * Navigates to a resolved route. On failure the error names only the route template: Playwright's own error text
 * contains the full URL, which carries team, conversation or survey ids (report and console must not contain them).
 */
async function gotoRoute(page: Page, resolvedPath: string, template: string): Promise<void> {
  try {
    await page.goto(`${BASE_URL}${resolvedPath}`);
  } catch {
    throw new Error(`navigation to ${template} failed`);
  }
}

async function capture(page: Page, route: Route, resolvedPath: string | null, viewport: number, theme: string, listSelector?: string) {
  const name = `ref-${route.ref}-${route.name}-w${viewport}-${theme}`;
  if (resolvedPath === null) {
    report.push({ ref: route.ref, viewport, theme, url: "", status: "not_found", note: "no matching link in the signed-in UI" });
    return;
  }
  await page.setViewportSize({ width: viewport, height: 900 });
  // localStorage is only reachable once the page is on the app origin; set the theme, then load the route.
  await page.goto(`${BASE_URL}/sign-in`);
  await page.evaluate((t) => window.localStorage.setItem("devpulse.theme", t), theme);
  await gotoRoute(page, resolvedPath, route.template ?? route.path);
  const ready = await settle(page);
  await page.screenshot({ path: `${DIR}${name}.png`, fullPage: true });
  const m = await measure(page);
  let listHeightPx: number | null = null;
  if (listSelector) {
    const box = await page.locator(listSelector).first().boundingBox().catch(() => null);
    listHeightPx = box ? Math.round(box.height) : null;
  }
  report.push({
    ref: route.ref,
    viewport,
    theme,
    // The route template, not the resolved path: resolved paths contain team, conversation and survey ids.
    url: route.template ?? route.path,
    // A capture taken while loading copy was still visible is not a verified result (TASK-026).
    status: ready ? "captured" : "not_verified",
    ...m,
    listHeightPx,
    ready,
    note: ready ? undefined : "captured while loading text was still visible",
  });
}

test.describe.configure({ mode: "serial" });

test("signed-out references 01 and 02 at all widths and themes", async ({ browser }: { browser: Browser }) => {
  // Every width and theme waits for loaded data (TASK-026), so the default 30 s test budget is too short.
  test.setTimeout(900_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  mkdirSync(DIR, { recursive: true });
  const routes: Route[] = [
    { ref: "01", name: "public-home", signedIn: false, path: "/" },
    { ref: "02", name: "sign-in", signedIn: false, path: "/sign-in" },
  ];
  for (const route of routes) {
    for (const theme of THEMES) {
      for (const width of [...WIDTHS, ZOOM_WIDTH]) {
        await capture(page, route, route.path, width, theme);
      }
    }
  }
  await context.close();
});

test("signed-in references 03 to 14 at all widths and themes", async ({ page }) => {
  // Worst case per capture: goto (30 s) + settle (up to 25 s + 16 s heading/timeout) + screenshot and measure.
  // 156 captures (6 widths x 2 themes + zoom proxy per route) at about 5 to 10 s each; the budget is 2 hours. The report is written in a finally block.
  test.setTimeout(3_600_000 * 2);
  mkdirSync(DIR, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);

  // Discover dynamic routes from the signed-in UI; never log their contents.
  await page.goto(`${BASE_URL}/teams`);
  await settle(page);
  const teamPath = await firstHref(page, "/teams/", ["/roadmap"]);

  await page.goto(`${BASE_URL}/me/conversations`);
  await settle(page);
  const conversationPath = await firstHref(page, "/me/conversations/");

  await page.goto(`${BASE_URL}/me/surveys`).catch(() => undefined);
  const surveyPath = await firstHref(page, "/survey/");

  const routes: Route[] = [
    { ref: "03", name: "app-home", signedIn: true, path: "/" },
    { ref: "04", name: "teams", signedIn: true, path: "/teams" },
    { ref: "05", name: "team-overview", signedIn: true, path: teamPath ?? "", template: "/teams/[teamId]" },
    { ref: "06", name: "team-roadmap", signedIn: true, path: teamPath ? `${teamPath}/roadmap` : "", template: "/teams/[teamId]/roadmap" },
    { ref: "07", name: "my-skills", signedIn: true, path: "/me/skills" },
    { ref: "08", name: "my-goals", signedIn: true, path: "/me/goals" },
    { ref: "09", name: "conversations", signedIn: true, path: "/me/conversations" },
    { ref: "10", name: "conversation-detail", signedIn: true, path: conversationPath ?? "", template: "/me/conversations/[conversationId]" },
    { ref: "11", name: "admin-teams", signedIn: true, path: "/admin/teams" },
    { ref: "12", name: "admin-roles", signedIn: true, path: "/admin/roles" },
    { ref: "13", name: "my-profile", signedIn: true, path: "/me/profile" },
    { ref: "14", name: "survey", signedIn: false, path: surveyPath ?? "", template: "/survey/[surveyId]" },
  ];

  try {
    for (const route of routes) {
      for (const theme of THEMES) {
        for (const width of WIDTHS) {
          await capture(page, route, route.path || null, width, theme, route.ref === "09" || route.ref === "10" ? "ul, ol" : undefined);
        }
      }
      // 200 % zoom proxy, light theme only.
      await capture(page, route, route.path || null, ZOOM_WIDTH, "lys");
    }
  } finally {
    // Written even when a capture throws, so the per-capture readiness record survives a timeout.
    writeFileSync(`${DIR}report.json`, JSON.stringify(report, null, 2));
  }
  expect(report.length).toBeGreaterThan(0);
});

/**
 * Live Firestore listeners keep the network busy, so settle on load plus the first heading, not networkidle.
 * Then wait (bounded) until no loading copy ("Laster…") is visible in the page text (TASK-026). Returns false
 * when loading text was still present at the timeout, so the capture is recorded as not ready, not as complete.
 */
async function settle(page: Page): Promise<boolean> {
  await page.waitForLoadState("load");
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  // Ready only after the loading copy has been absent for a continuous quiet window. A single absent poll can
  // happen before the client renders its loading states, so one check is not enough (visual-fidelity TASK-027 check).
  const ready = await page
    .waitForFunction(
      () => {
        const state = window as unknown as { __quietSince?: number };
        if (/Laster\b[^\n]*…/.test(document.body.innerText)) {
          state.__quietSince = undefined;
          return false;
        }
        state.__quietSince ??= Date.now();
        return Date.now() - state.__quietSince >= 1500;
      },
      undefined,
      { timeout: 25_000, polling: 250 },
    )
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(1000);
  return ready;
}

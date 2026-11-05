import { test, expect, type Page, type Browser } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { BASE_URL, OUTPUT_DIR, readCredentials } from "./guards";

// visual-fidelity-and-ui-fixes TASK-020: page-level overlap measurement (BR-25, BR-6, BR-22 style).
// Public pages first (no sign-in), then one real sign-in for the signed-in routes (BR-37: one sign-in per run).
// Measures bounding boxes of page-level elements and reports every pair of non-nested elements whose boxes
// intersect by more than 1 px in each direction. Also records document-level horizontal scroll.
// The report carries route templates, tags, test ids, computed positioning and short CSS paths only.
// No page text, names, ids or resolved URLs are written.

const WIDTHS = [320, 360, 375, 768, 1024, 1280] as const;
const THEMES = ["lys", "mork"] as const;
const DIR = `${OUTPUT_DIR}overlap/`;

type Pair = {
  a: string;
  b: string;
  aPosition: string;
  bPosition: string;
  aAriaHidden: boolean;
  bAriaHidden: boolean;
  overlapPx: { w: number; h: number };
};
type Row = {
  route: string;
  width: number;
  theme: string;
  status: "measured" | "not_found" | "error";
  horizontalScroll?: boolean;
  scrollWidth?: number;
  clientWidth?: number;
  elementCount?: number;
  pairCount?: number;
  pairs?: Pair[];
  ready?: boolean;
  note?: string;
};

const rows: Row[] = [];

async function signIn(page: Page): Promise<void> {
  const creds = readCredentials();
  if (!creds.ok) throw new Error(creds.message);
  await page.goto(`${BASE_URL}/sign-in`);
  await page.getByLabel("E-postadresse").fill(creds.email);
  await page.getByLabel("Passord").fill(creds.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await page.waitForFunction(() => !window.location.pathname.startsWith("/sign-in"), undefined, {
    timeout: 60_000,
    polling: 250,
  });
}

/** Same readiness rule as visual-references.spec.ts (TASK-026): loading copy absent for a quiet window. */
async function settle(page: Page): Promise<boolean> {
  await page.waitForLoadState("load");
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
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
  await page.waitForTimeout(500);
  return ready;
}

async function firstHref(page: Page, prefix: string, excludeSuffixes: string[] = []): Promise<string | null> {
  await page
    .locator(`a[href^="${prefix}"]`)
    .first()
    .waitFor({ state: "attached", timeout: 20_000 })
    .catch(() => undefined);
  const hrefs = await page
    .locator(`a[href^="${prefix}"]`)
    .evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""))
    .catch(() => [] as string[]);
  const found = hrefs.find((href) => href.length > prefix.length && !excludeSuffixes.some((s) => href.endsWith(s)));
  return found ?? null;
}

/** Runs in the browser: overlap of page-level element boxes (non-nested pairs, > 1 px in both axes). */
function measureInPage(): {
  horizontalScroll: boolean;
  scrollWidth: number;
  clientWidth: number;
  elementCount: number;
  pairs: Pair[];
} {
  const doc = document.documentElement;
  const selector =
    "h1,h2,h3,p,section,article,aside,header,footer,nav,form,ul,ol,li,button,a,input,select,textarea,table,img,svg,[role=tablist],[role=tab],[role=tabpanel],[role=region],[data-testid]";
  const cssPath = (el: Element): string => {
    const parts: string[] = [];
    let n: Element | null = el;
    for (let depth = 0; n && depth < 6 && n !== document.body; depth++) {
      const parent: Element | null = n.parentElement;
      const tag = n.tagName.toLowerCase();
      const tid = n.getAttribute("data-testid");
      let part = tid ? `${tag}[data-testid]` : tag;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === n!.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`;
      }
      parts.unshift(part);
      n = parent;
    }
    return parts.join(" > ");
  };
  const items = (Array.from(document.querySelectorAll(selector)) as Element[]).filter((el) => {
    // Chart internals and SVG children are not page-level elements.
    if (el.tagName.toLowerCase() !== "svg" && el.closest("svg")) return false;
    const visible = (el as HTMLElement).checkVisibility
      ? (el as HTMLElement).checkVisibility({ visibilityProperty: true })
      : true;
    if (!visible) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  });
  const pairs: Pair[] = [];
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    const ra = a.getBoundingClientRect();
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      if (a.contains(b) || b.contains(a)) continue;
      const rb = b.getBoundingClientRect();
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 1 && h > 1) {
        pairs.push({
          a: cssPath(a),
          b: cssPath(b),
          aPosition: getComputedStyle(a).position,
          bPosition: getComputedStyle(b).position,
          aAriaHidden: a.closest('[aria-hidden="true"]') !== null,
          bAriaHidden: b.closest('[aria-hidden="true"]') !== null,
          overlapPx: { w: Math.round(w), h: Math.round(h) },
        });
      }
    }
  }
  return {
    horizontalScroll: doc.scrollWidth > doc.clientWidth,
    scrollWidth: doc.scrollWidth,
    clientWidth: doc.clientWidth,
    elementCount: items.length,
    pairs,
  };
}

async function measureRoute(page: Page, route: string, path: string | null, width: number, theme: string): Promise<void> {
  if (path === null) {
    rows.push({ route, width, theme, status: "not_found", note: "no matching link in the signed-in UI" });
    return;
  }
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${BASE_URL}/sign-in`);
  await page.evaluate((t) => window.localStorage.setItem("devpulse.theme", t), theme);
  try {
    await page.goto(`${BASE_URL}${path}`);
  } catch {
    rows.push({ route, width, theme, status: "error", note: "navigation failed" });
    return;
  }
  const ready = await settle(page);
  const m = await page.evaluate(measureInPage);
  rows.push({
    route,
    width,
    theme,
    status: "measured",
    horizontalScroll: m.horizontalScroll,
    scrollWidth: m.scrollWidth,
    clientWidth: m.clientWidth,
    elementCount: m.elementCount,
    pairCount: m.pairs.length,
    // Keep the first 25 pairs per capture; the count is exact.
    pairs: m.pairs.slice(0, 25),
    ready,
    note: ready ? undefined : "measured while loading text was still visible",
  });
}

test.describe.configure({ mode: "serial" });

test("page-level overlap and horizontal scroll, public and signed-in pages", async ({ browser }: { browser: Browser }) => {
  test.setTimeout(3_600_000);
  mkdirSync(DIR, { recursive: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        await measureRoute(page, "/ (public, reference 01)", "/", width, theme);
        await measureRoute(page, "/sign-in (reference 02)", "/sign-in", width, theme);
      }
    }
    await signIn(page);
    await page.goto(`${BASE_URL}/teams`);
    await settle(page);
    const teamPath = await firstHref(page, "/teams/", ["/roadmap"]);
    await page.goto(`${BASE_URL}/me/conversations`);
    await settle(page);
    const conversationPath = await firstHref(page, "/me/conversations/");

    const routes: { route: string; path: string | null }[] = [
      { route: "/ (signed in, reference 03)", path: "/" },
      { route: "/teams (reference 04)", path: "/teams" },
      { route: "/teams/[teamId] (reference 05)", path: teamPath },
      { route: "/teams/[teamId]/roadmap (reference 06)", path: teamPath ? `${teamPath}/roadmap` : null },
      { route: "/me/skills (reference 07)", path: "/me/skills" },
      { route: "/me/goals (reference 08)", path: "/me/goals" },
      { route: "/me/conversations (reference 09)", path: "/me/conversations" },
      { route: "/me/conversations/[conversationId] (reference 10)", path: conversationPath },
      { route: "/admin/teams (reference 11)", path: "/admin/teams" },
      { route: "/admin/roles (reference 12)", path: "/admin/roles" },
      { route: "/me/profile (reference 13)", path: "/me/profile" },
    ];
    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        for (const r of routes) {
          await measureRoute(page, r.route, r.path, width, theme);
        }
      }
    }
  } finally {
    writeFileSync(`${DIR}page-overlap.json`, JSON.stringify({ rows }, null, 2));
    await context.close();
  }
  expect(rows.length).toBeGreaterThan(0);
});

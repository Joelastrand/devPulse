import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { BASE_URL, OUTPUT_DIR, readCredentials } from "./guards";

// visual-fidelity-and-ui-fixes TASK-021: automated accessibility scans (axe, WCAG 2.x A/AA), a keyboard-only
// navigation pass and the sign-out path, at 320 and 768 px, through the real sign-in form with the owner's test
// account (runtime env vars). Reports contain rule ids, impact, counts, element kinds, geometry and screenshot
// file names only: no page text, names, ids or resolved URLs.

const WIDTHS = [320, 768] as const;
const DIR = `${OUTPUT_DIR}a11y/`;
const TAB_LIMIT = 160;

type AxeRow = {
  route: string;
  width: number;
  ruleId: string;
  impact: string | null;
  nodes: number;
};

type AxeIncompleteRow = {
  route: string;
  width: number;
  ruleId: string;
  impact: string | null;
  nodes: number;
  /** Axe's own incomplete reason per node: "incomplete" messages are generic; the summary is the check's text. */
  incompleteReasons: string[];
  /** Element kind (tag, role, input type) and the first CSS-free selector hint: never text. */
  nodeKinds: string[];
};

type KeyboardRow = {
  route: string;
  width: number;
  /** Tab presses that were made. */
  tabPresses: number;
  /** Tab presses after which document.activeElement was a page element. */
  focusStops: number;
  /** Tab presses after which focus was not on any page element (for example browser UI such as a date picker). */
  focusOutsideDocumentStops: number;
  /** Stops where the target is the same element as the previous stop (for example Tab between the segments of a native date input). */
  repeatedStops: number;
  /** Distinct page elements that received focus. */
  uniqueFocusTargets: number;
  hiddenOrOffscreenStops: number;
  /** Distinct elements that received focus without any outline or box-shadow indicator. */
  uniqueTargetsWithoutIndicator: number;
  /** Raw stops (including repeats) that landed on an element without an indicator. */
  stopsWithoutIndicator: number;
  noIndicatorKinds: string[];
  /** Distinct native date inputs reached by Tab. */
  dateInputTargets: number;
  dateInputWithFocusVisible: number;
  dateInputWithIndicator: number;
  dateScreenshots: string[];
  reachedMainContent: boolean;
};

/** Element kind only: tag names with classes, ids, attributes and text stripped. */
function tagOnlySelector(selector: string): string {
  return selector.split(/[s>+~]+/).map((part) => part.replace(/[#.:[].*$/, "")).filter((part) => /^[a-z][a-z0-9-]*$/i.test(part)).join(">");
}

/** Navigates to a route; on failure the error names only the route template (no resolved ids or URL). */
async function gotoRoute(page: Page, path: string, name: string): Promise<void> {
  await page.goto(BASE_URL + path).catch(() => {
    throw new Error(`navigation failed for route ${name}`);
  });
}

const axeRows: AxeRow[] = [];
const axeIncomplete: AxeIncompleteRow[] = [];
const axeScans: { route: string; width: number; violations: number; passes: number; incomplete: number }[] = [];
const keyboardRows: KeyboardRow[] = [];
const notes: string[] = [
  "Focus classification: a stop is a repeat when document.activeElement is the same element as the previous stop. Repeats are reported separately and are not counted as separate targets. Focus that leaves the document is reported as focusOutsideDocumentStops.",
  "Limitation: the segments inside a native date input are in the browser's internal shadow tree. Their focus is not visible to page script, so the indicator is measured on the input element itself, and the segment-level ring is verified only through screenshots.",
  "Limitation: the calendar picker of a native date input is browser UI outside the DOM. It cannot be inspected through activeElement; its presence is only inferred from focus leaving the document.",
];

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

/** Waits (bounded) until no loading copy is present for a short quiet window (same rule as the capture harness). */
async function settle(page: Page): Promise<void> {
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  await page
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
    .catch(() => undefined);
}

async function firstHref(page: Page, prefix: string, excludeSuffixes: string[] = []): Promise<string | null> {
  await page
    .locator(`a[href^="${prefix}"]`)
    .first()
    .waitFor({ state: "attached", timeout: 20_000 })
    .catch(() => undefined);
  const hrefs = await page.locator(`a[href^="${prefix}"]`).evaluateAll((els) =>
    els.map((el) => el.getAttribute("href") ?? ""),
  );
  return hrefs.find((href) => href.length > prefix.length && !excludeSuffixes.some((s) => href.endsWith(s))) ?? null;
}

async function resolveRoutes(page: Page): Promise<{ name: string; path: string }[]> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE_URL}/teams`);
  await settle(page);
  const teamPath = await firstHref(page, "/teams/", ["/roadmap"]);
  await page.goto(`${BASE_URL}/me/conversations`);
  await settle(page);
  const conversationPath = await firstHref(page, "/me/conversations/");
  const routes = [
    { name: "/", path: "/" },
    { name: "/teams", path: "/teams" },
    { name: "/teams/[teamId]", path: teamPath ?? "" },
    { name: "/teams/[teamId]/roadmap", path: teamPath ? `${teamPath}/roadmap` : "" },
    { name: "/me/skills", path: "/me/skills" },
    { name: "/me/goals", path: "/me/goals" },
    { name: "/me/conversations", path: "/me/conversations" },
    { name: "/me/conversations/[conversationId]", path: conversationPath ?? "" },
    { name: "/me/profile", path: "/me/profile" },
    { name: "/admin/teams", path: "/admin/teams" },
    { name: "/admin/roles", path: "/admin/roles" },
  ];
  return routes.filter((route) => route.path !== "");
}

async function runAxe(page: Page, route: string, width: number): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  axeScans.push({
    route,
    width,
    violations: results.violations.length,
    passes: results.passes.length,
    incomplete: results.incomplete.length,
  });
  for (const violation of results.violations) {
    axeRows.push({ route, width, ruleId: violation.id, impact: violation.impact ?? null, nodes: violation.nodes.length });
  }
  for (const item of results.incomplete) {
    axeIncomplete.push({
      route,
      width,
      ruleId: item.id,
      impact: item.impact ?? null,
      nodes: item.nodes.length,
      incompleteReasons: item.nodes.map((node) => (node.any.concat(node.all, node.none).map((c) => c.message)).join(" | ")),
      nodeKinds: item.nodes.map((node) => node.target.map((t) => tagOnlySelector(String(t))).join(" ")),
    });
  }
}

type FocusInfo = {
  /** Stable id for the element within this page load (not an element id from the DOM). */
  id: number;
  isMain: boolean;
  visible: boolean;
  inViewport: boolean;
  focusVisible: boolean;
  hasIndicator: boolean;
  indicatorSource: "outline" | "box-shadow" | "none";
  aboutHaspopup: boolean;
  devOverlay: boolean;
  isDateInput: boolean;
  /** Element kind only (tag, role, input type). Never text. */
  kind: string;
  rect: { x: number; y: number; width: number; height: number };
};

/**
 * Reads the element that currently has focus. Returns null when focus is not on a page element, which is the case
 * when focus has moved into browser UI outside the DOM (for example a native date picker popup).
 */
async function currentFocus(page: Page): Promise<FocusInfo | null> {
  return page.evaluate(() => {
    type Win = Window & { __kbdIds?: WeakMap<Element, number>; __kbdNext?: number };
    const w = window as Win;
    w.__kbdIds ??= new WeakMap();
    w.__kbdNext ??= 1;
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || el === document.documentElement) return null;
    let id = w.__kbdIds.get(el);
    if (id === undefined) {
      id = w.__kbdNext++;
      w.__kbdIds.set(el, id);
    }
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const outline = style.outlineStyle !== "none" && style.outlineWidth !== "0px";
    const shadow = style.boxShadow !== "none";
    const indicatorSource: "outline" | "box-shadow" | "none" = outline ? "outline" : shadow ? "box-shadow" : "none";
    const isDateInput = el.tagName === "INPUT" && (el as HTMLInputElement).type === "date";
    return {
      id,
      isMain: el.closest("main") !== null,
      visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden",
      inViewport: rect.left >= -1 && rect.right <= window.innerWidth + 1,
      focusVisible: el.matches(":focus-visible"),
      hasIndicator: outline || shadow,
      indicatorSource,
      aboutHaspopup: el.getAttribute("aria-haspopup") === "true",
      // The Next.js development overlay is injected only by `next dev`; it is not product UI and is excluded.
      devOverlay: el.tagName === "NEXTJS-PORTAL",
      isDateInput,
      kind: [el.tagName.toLowerCase(), el.getAttribute("role") ?? "", el.getAttribute("type") ?? ""].join(":"),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });
}

function slug(text: string): string {
  return text.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

async function keyboardPass(page: Page, routeName: string, routePath: string, width: number): Promise<void> {
  await gotoRoute(page, routePath, routeName);
  await settle(page);
  // Start from the top of the document so the first Tab lands on the first focusable element.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  const row: KeyboardRow = {
    route: routeName,
    width,
    tabPresses: 0,
    focusStops: 0,
    focusOutsideDocumentStops: 0,
    repeatedStops: 0,
    uniqueFocusTargets: 0,
    hiddenOrOffscreenStops: 0,
    uniqueTargetsWithoutIndicator: 0,
    stopsWithoutIndicator: 0,
    noIndicatorKinds: [],
    dateInputTargets: 0,
    dateInputWithFocusVisible: 0,
    dateInputWithIndicator: 0,
    dateScreenshots: [],
    reachedMainContent: false,
  };
  const seenTargets = new Set<number>();
  const seenWithoutIndicator = new Set<number>();
  const noIndicatorKinds = new Set<string>();
  const seenDateInputs = new Set<number>();
  let previousId: number | null = null;

  for (let i = 0; i < TAB_LIMIT; i++) {
    await page.keyboard.press("Tab");
    row.tabPresses++;
    const info = await currentFocus(page);
    if (info === null) {
      row.focusOutsideDocumentStops++;
      previousId = null;
      continue;
    }
    if (info.devOverlay) continue;
    row.focusStops++;
    if (info.id === previousId) {
      row.repeatedStops++;
    }
    previousId = info.id;
    if (info.isMain) row.reachedMainContent = true;
    if (!info.visible || !info.inViewport) row.hiddenOrOffscreenStops++;
    if (!seenTargets.has(info.id)) {
      seenTargets.add(info.id);
      if (!info.hasIndicator) {
        seenWithoutIndicator.add(info.id);
        noIndicatorKinds.add(info.kind);
      }
    }
    if (!info.hasIndicator) row.stopsWithoutIndicator++;
    if (info.isDateInput && !seenDateInputs.has(info.id)) {
      seenDateInputs.add(info.id);
      if (info.focusVisible) row.dateInputWithFocusVisible++;
      if (info.hasIndicator) row.dateInputWithIndicator++;
      // One screenshot per date input per route and width, cropped around the element for visual inspection.
      if (row.dateScreenshots.length < 3) {
        const name = `date-focus-${slug(routeName)}-w${width}-${row.dateScreenshots.length + 1}.png`;
        const pad = 24;
        await page.screenshot({
          path: `${DIR}${name}`,
          clip: {
            x: Math.max(0, info.rect.x - pad),
            y: Math.max(0, info.rect.y - pad),
            width: Math.min(width, info.rect.width + pad * 2),
            height: info.rect.height + pad * 2,
          },
        });
        row.dateScreenshots.push(name);
      }
    }
  }
  row.uniqueFocusTargets = seenTargets.size;
  row.uniqueTargetsWithoutIndicator = seenWithoutIndicator.size;
  row.noIndicatorKinds = [...noIndicatorKinds];
  row.dateInputTargets = seenDateInputs.size;
  keyboardRows.push(row);
}

test.describe.configure({ mode: "serial" });

test("automated accessibility scans and keyboard pass at 320 and 768 px", async ({ browser }) => {
  test.setTimeout(3_600_000);
  mkdirSync(DIR, { recursive: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await signIn(page);
    const routes = await resolveRoutes(page);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        await gotoRoute(page, route.path, route.name);
        await settle(page);
        await runAxe(page, route.name, width);
        await keyboardPass(page, route.name, route.path, width);
      }
    }
  } finally {
    writeFileSync(
      `${DIR}report.json`,
      JSON.stringify({ axeScans, axe: axeRows, axeIncomplete, keyboard: keyboardRows, notes }, null, 2),
    );
    await context.close();
  }
  expect(keyboardRows.length).toBeGreaterThan(0);
});

test("sign-out is reachable by keyboard at 320 and 768 px and ends the signed-in session", async ({ browser }) => {
  test.setTimeout(600_000);
  mkdirSync(DIR, { recursive: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const outcomes: { width: number; trigger: boolean; menuItemReached: boolean; signedOut: boolean }[] = [];
  try {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await signIn(page);
      await page.goto(`${BASE_URL}/`);
      await settle(page);
      // Reach the account trigger by Tab, then open it with Enter.
      let trigger = false;
      for (let i = 0; i < TAB_LIMIT && !trigger; i++) {
        await page.keyboard.press("Tab");
        const info = await currentFocus(page);
        trigger = info?.aboutHaspopup === true;
      }
      if (trigger) await page.keyboard.press("Enter");
      // Move to the sign-out item by Tab within the open menu.
      let menuItemReached = false;
      if (trigger) {
        for (let i = 0; i < 6 && !menuItemReached; i++) {
          await page.keyboard.press("Tab");
          menuItemReached = await page.evaluate(() => (document.activeElement?.textContent ?? "").trim() === "Logg ut");
        }
      }
      if (menuItemReached) await page.keyboard.press("Enter");
      // Wait for the signed-out state to render before checking it (the URL may already be "/").
      await page.getByRole("link", { name: "Logg inn" }).first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
      await page.goto(`${BASE_URL}/me/profile`).catch(() => undefined);
      await page.getByRole("link", { name: "Logg inn" }).first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
      // Signed-out state: no account trigger, and the signed-out sign-in link on a protected route (no redirect is used).
      const signedOut =
        (await page.locator("button[aria-haspopup=\"true\"]").count()) === 0 &&
        (await page.getByRole("link", { name: "Logg inn" }).count()) > 0;
      outcomes.push({ width, trigger, menuItemReached, signedOut });
      await context.clearCookies();
    }
  } finally {
    writeFileSync(`${DIR}signout.json`, JSON.stringify(outcomes, null, 2));
    await context.close();
  }
  expect(outcomes.every((o) => o.signedOut)).toBe(true);
});

// visual-fidelity-and-ui-fixes TASK-021: the public sign-in page is not reachable by the owner's signed-in pass.
// This test is signed out and performs no sign-in, so it adds no BR-37 sign-in.
test("public sign-in page: automated scan and keyboard pass at 320 and 768 px (signed out, no sign-in)", async ({ browser }) => {
  test.setTimeout(900_000);
  mkdirSync(DIR, { recursive: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${BASE_URL}/sign-in`);
      await settle(page);
      await runAxe(page, "/sign-in", width);
      await keyboardPass(page, "/sign-in", "/sign-in", width);
    }
  } finally {
    writeFileSync(
      `${DIR}sign-in-report.json`,
      JSON.stringify({ axeScans: axeScans.filter((s) => s.route === "/sign-in"), axe: axeRows.filter((r) => r.route === "/sign-in"), axeIncomplete: axeIncomplete.filter((r) => r.route === "/sign-in"), keyboard: keyboardRows.filter((r) => r.route === "/sign-in"), notes }, null, 2),
    );
    await context.close();
  }
  expect(keyboardRows.some((r) => r.route === "/sign-in")).toBe(true);
});

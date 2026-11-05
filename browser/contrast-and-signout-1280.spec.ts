import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { BASE_URL, OUTPUT_DIR, readCredentials } from "./guards";

// visual-fidelity-and-ui-fixes TASK-021 (contrast review) and keyboard sign-out at 1280 px.
// One real sign-in for the whole run (decision 2 / BR-37). The sign-in uses an invalid `continue`
// value, so the landing check also covers the open-redirect fallback (expected landing: "/").
// Reports contain rule ids, colours, sizes, ratios, element kinds and route templates only.
// No page text, names, ids or resolved URLs are written.

const DIR = `${OUTPUT_DIR}a11y/`;
const TAB_LIMIT = 160;

type Measured = {
  route: string;
  width: number;
  kind: string;
  fg: string;
  bg: string;
  bgSource: "opaque-ancestor" | "default-white" | "unresolved";
  opacity: number;
  fontPx: number;
  fontWeight: number;
  ratio: number | null;
  largeText: boolean;
  passesAA: boolean | null;
  axeReason: string;
  matched: boolean;
};

const measured: Measured[] = [];
const notes: string[] = [
  "Contrast method: foreground is the computed colour (`fill` for SVG text, `color` for HTML text), multiplied by the element's effective opacity. Background is the first opaque ancestor background (alpha-composited partial layers over it). When no opaque background is found, white is assumed and marked default-white.",
  "Limitation: text drawn over an image, a gradient or an overlapping sibling cannot be resolved from computed styles. Those rows are marked unresolved and are not claimed as passes.",
  "Limitation: the measurement covers the light theme only. Dark theme was not measured in this run.",
];

function readCredentialsOrThrow() {
  const creds = readCredentials();
  if (!creds.ok) throw new Error(creds.message);
  return creds;
}

async function signInWithInvalidContinue(page: Page): Promise<string> {
  const creds = readCredentialsOrThrow();
  await page.goto(`${BASE_URL}/sign-in?continue=//evil.example`);
  await page.getByLabel("E-postadresse").fill(creds.email);
  await page.getByLabel("Passord").fill(creds.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await page.waitForFunction(() => !window.location.pathname.startsWith("/sign-in"), undefined, {
    timeout: 60_000,
    polling: 250,
  });
  return new URL(page.url()).pathname;
}

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

async function firstTeamPath(page: Page): Promise<string | null> {
  await page.goto(`${BASE_URL}/teams`);
  await settle(page);
  const hrefs = await page
    .locator('a[href^="/teams/"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
  return hrefs.find((h) => h.length > "/teams/".length && !h.endsWith("/roadmap")) ?? null;
}

type NodeProbe = {
  found: boolean;
  kind: string;
  fg: string;
  bg: string;
  bgSource: "opaque-ancestor" | "default-white" | "unresolved";
  opacity: number;
  fontPx: number;
  fontWeight: number;
  ratio: number | null;
};

/** Measures one selector (the first match) in the page. Runs inside the browser. */
async function probe(page: Page, selector: string): Promise<NodeProbe> {
  return page.evaluate((sel) => {
    const parse = (c: string): [number, number, number, number] | null => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return null;
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    };
    const lin = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const lum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const blend = (fg: number[], bg: number[]) => {
      const a = fg[3];
      return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
    };

    const el = document.querySelector(sel) as Element | null;
    if (!el) {
      return { found: false, kind: "", fg: "", bg: "", bgSource: "unresolved", opacity: 1, fontPx: 0, fontWeight: 0, ratio: null };
    }
    const cs = getComputedStyle(el);
    const isSvg = el instanceof SVGElement;
    const fgRaw = isSvg ? cs.fill : cs.color;
    const fgParsed = parse(fgRaw);

    // Effective opacity: product of opacity on the element and its ancestors.
    let opacity = 1;
    for (let n: Element | null = el; n; n = n.parentElement) {
      opacity *= Number(getComputedStyle(n).opacity);
    }

    // Background: first opaque background on an HTML ancestor, composited with partial layers above it.
    const layers: number[][] = [];
    let bgSource: "opaque-ancestor" | "default-white" | "unresolved" = "default-white";
    let base: number[] = [255, 255, 255, 1];
    let hasImage = false;
    for (let n: Element | null = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== "none") hasImage = true;
      const c = parse(s.backgroundColor);
      if (c && c[3] > 0) {
        if (c[3] >= 1) {
          base = c;
          bgSource = "opaque-ancestor";
          break;
        }
        layers.push(c);
      }
    }
    if (hasImage) bgSource = "unresolved";
    let bg = base;
    for (let i = layers.length - 1; i >= 0; i--) bg = blend(layers[i], bg);

    let ratio: number | null = null;
    if (fgParsed && bgSource !== "unresolved") {
      const fg = blend([fgParsed[0], fgParsed[1], fgParsed[2], fgParsed[3] * opacity], bg);
      const l1 = lum(fg[0], fg[1], fg[2]);
      const l2 = lum(bg[0], bg[1], bg[2]);
      ratio = Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
    }
    const fmt = (c: number[]) => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;
    return {
      found: true,
      kind: [el.tagName.toLowerCase(), isSvg ? "svg" : "html"].join(":"),
      fg: fgParsed ? fmt(fgParsed) : fgRaw,
      bg: fmt(bg),
      bgSource,
      opacity: Math.round(opacity * 100) / 100,
      fontPx: parseFloat(cs.fontSize),
      fontWeight: parseInt(cs.fontWeight, 10),
      ratio,
    };
  }, selector);
}

test.describe.configure({ mode: "serial" });

test("contrast review of incomplete axe checks, then keyboard sign-out at 1280 px", async ({ browser }) => {
  test.setTimeout(900_000);
  mkdirSync(DIR, { recursive: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const outcome: Record<string, unknown> = {};
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    outcome.landingAfterInvalidContinue = await signInWithInvalidContinue(page);
    outcome.landingOrigin = new URL(page.url()).origin === BASE_URL ? "same-origin" : "other-origin";

    const teamPath = await firstTeamPath(page);
    const routes: { name: string; path: string }[] = [
      { name: "/", path: "/" },
      ...(teamPath ? [{ name: "/teams/[teamId]", path: teamPath }] : []),
    ];

    for (const width of [320, 768] as const) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        await page.goto(`${BASE_URL}${route.path}`).catch(() => {
          throw new Error(`navigation failed for route ${route.name}`);
        });
        await settle(page);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .options({ rules: { "color-contrast": { enabled: true } } })
          .analyze();
        const incomplete = results.incomplete.filter((r) => r.id === "color-contrast");
        for (const item of incomplete) {
          for (const node of item.nodes) {
            const selector = node.target.join(" ");
            const reason = node.any.concat(node.all, node.none).map((c) => c.message).join(" | ");
            // Only the first matching element is measured, and the target is an axe selector (no text).
            const p = await probe(page, selector).catch(() => null);
            const row: Measured = {
              route: route.name,
              width,
              kind: p?.kind ?? "unmatched",
              fg: p?.fg ?? "",
              bg: p?.bg ?? "",
              bgSource: p?.bgSource ?? "unresolved",
              opacity: p?.opacity ?? 1,
              fontPx: p?.fontPx ?? 0,
              fontWeight: p?.fontWeight ?? 0,
              ratio: p?.ratio ?? null,
              largeText: p ? p.fontPx >= 24 || (p.fontPx >= 18.66 && p.fontWeight >= 700) : false,
              passesAA: null,
              axeReason: reason.slice(0, 160),
              matched: p?.found ?? false,
            };
            row.passesAA =
              row.ratio === null ? null : row.ratio >= (row.largeText ? 3 : 4.5);
            measured.push(row);
          }
        }
      }
    }

    // Keyboard sign-out at 1280 px: trigger by Tab, Enter, Tab to "Logg ut", Enter.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE_URL}/`);
    await settle(page);
    let trigger = false;
    for (let i = 0; i < TAB_LIMIT && !trigger; i++) {
      await page.keyboard.press("Tab");
      trigger = await page.evaluate(() => document.activeElement?.getAttribute("aria-haspopup") === "true");
    }
    let menuItemReached = false;
    if (trigger) {
      await page.keyboard.press("Enter");
      for (let i = 0; i < 6 && !menuItemReached; i++) {
        await page.keyboard.press("Tab");
        menuItemReached = await page.evaluate(() => (document.activeElement?.textContent ?? "").trim() === "Logg ut");
      }
    }
    if (menuItemReached) await page.keyboard.press("Enter");
    await page.getByRole("link", { name: "Logg inn" }).first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
    outcome.signOut1280 = {
      trigger,
      menuItemReached,
      landingPath: new URL(page.url()).pathname,
      accountTriggerPresent: (await page.locator('button[aria-haspopup="true"]').count()) > 0,
      signInLinkPresent: (await page.getByRole("link", { name: "Logg inn" }).count()) > 0,
    };
  } finally {
    writeFileSync(
      `${DIR}contrast-and-signout-1280.json`,
      JSON.stringify({ outcome, measured, notes }, null, 2),
    );
    await context.close();
  }
  expect(measured.length).toBeGreaterThan(0);
});

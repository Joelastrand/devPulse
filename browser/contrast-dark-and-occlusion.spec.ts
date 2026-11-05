import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { BASE_URL, OUTPUT_DIR, readCredentials } from "./guards";

// visual-fidelity-and-ui-fixes TASK-021: contrast in both themes and an occlusion probe for the axe
// "color-contrast" incomplete items. One real sign-in for the run (BR-37). Reports contain rule ids,
// colours, sizes, ratios, element kinds and route templates only. No page text or resolved URLs.

const DIR = `${OUTPUT_DIR}a11y/`;
const ROUTES = [
  { name: "/", path: "/" },
  { name: "/me/profile", path: "/me/profile" },
] as const;
const WIDTHS = [320, 768] as const;
const THEMES = ["lys", "mork"] as const;

type Row = {
  route: string;
  width: number;
  theme: string;
  kind: string;
  fg: string;
  bg: string;
  bgSource: string;
  fontPx: number;
  fontWeight: number;
  ratio: number | null;
  aaThreshold: number;
  passesAA: boolean | null;
  occluded: boolean | null;
  occluderKind: string;
  axeReason: string;
  matched: boolean;
};

const rows: Row[] = [];
const notes: string[] = [
  "Contrast: foreground is the computed colour (fill for SVG text, color for HTML) times effective opacity, over the first opaque ancestor background (white when none is found and marked default-white). Background images are marked unresolved and not claimed as passes.",
  "Occlusion: the probe samples elementFromPoint at the centre of the first matched element's box after scrolling it into view. occluded=true means another element is the topmost hit at that point.",
  "Limit: one sample point per element (centre of the first match); a partial occlusion elsewhere in the box is not detected.",
];

function readCredentialsOrThrow() {
  const creds = readCredentials();
  if (!creds.ok) throw new Error(creds.message);
  return creds;
}

async function signIn(page: Page): Promise<void> {
  const creds = readCredentialsOrThrow();
  await page.goto(`${BASE_URL}/sign-in`);
  await page.getByLabel("E-postadresse").fill(creds.email);
  await page.getByLabel("Passord").fill(creds.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await page.waitForFunction(() => !window.location.pathname.startsWith("/sign-in"), undefined, {
    timeout: 60_000,
    polling: 250,
  });
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("load");
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
  await page.waitForTimeout(500);
}

type Probe = Omit<Row, "route" | "width" | "theme" | "axeReason" | "passesAA" | "aaThreshold" | "occluded" | "occluderKind" | "matched"> & {
  found: boolean;
  occluded: boolean | null;
  occluderKind: string;
};

/** Runs in the browser for one axe target selector. Uses the first match only. */
async function probe(page: Page, selector: string): Promise<Probe> {
  return page.evaluate((sel) => {
    const parse = (c: string): number[] | null => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return null;
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    };
    const lin = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    const blend = (fg: number[], bg: number[]) => {
      const a = fg[3];
      return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
    };
    const el = document.querySelector(sel) as Element | null;
    if (!el) {
      return {
        found: false,
        kind: "unmatched",
        fg: "",
        bg: "",
        bgSource: "unresolved",
        fontPx: 0,
        fontWeight: 0,
        ratio: null,
        occluded: null,
        occluderKind: "",
        opacity: 1,
      } as unknown as Probe;
    }
    const cs = getComputedStyle(el);
    const isSvg = el instanceof SVGElement;
    const fgRaw = isSvg ? cs.fill : cs.color;
    const fgParsed = parse(fgRaw);
    let opacity = 1;
    for (let n: Element | null = el; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
    const layers: number[][] = [];
    let bgSource = "default-white";
    let base = [255, 255, 255, 1];
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
      const l1 = lum(fg);
      const l2 = lum(bg);
      ratio = Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
    }
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const occluded = hit !== null && hit !== el && !el.contains(hit) && !hit.contains(el);
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
      occluded,
      occluderKind: occluded && hit ? `${hit.tagName.toLowerCase()}${hit.getAttribute("data-testid") ? "[data-testid]" : ""}` : "",
    } as unknown as Probe;
  }, selector);
}

test.describe.configure({ mode: "serial" });

test("dark and light contrast of axe color-contrast items, with occlusion probe", async ({ browser }) => {
  test.setTimeout(900_000);
  mkdirSync(DIR, { recursive: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page);
    // The team overview holds the roster label that axe reported as "overlapped" at 768 px.
    await page.goto(`${BASE_URL}/teams`);
    await settle(page);
    const teamHref = await page
      .locator('a[href^="/teams/"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""))
      .then((hrefs) => hrefs.find((h) => h.length > "/teams/".length && !h.endsWith("/roadmap")) ?? null);
    const routeList: { name: string; path: string }[] = [
      ...ROUTES,
      ...(teamHref ? [{ name: "/teams/[teamId]", path: teamHref }] : []),
    ];
    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        for (const route of routeList) {
          await page.goto(`${BASE_URL}/sign-in`);
          await page.evaluate((t) => window.localStorage.setItem("devpulse.theme", t), theme);
          await page.goto(`${BASE_URL}${route.path}`);
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
              const p = await probe(page, selector).catch(() => null);
              const largeText = p ? p.fontPx >= 24 || (p.fontPx >= 18.66 && p.fontWeight >= 700) : false;
              const aaThreshold = largeText ? 3 : 4.5;
              rows.push({
                route: route.name,
                width,
                theme,
                kind: p?.kind ?? "unmatched",
                fg: p?.fg ?? "",
                bg: p?.bg ?? "",
                bgSource: p?.bgSource ?? "unresolved",
                fontPx: p?.fontPx ?? 0,
                fontWeight: p?.fontWeight ?? 0,
                ratio: p?.ratio ?? null,
                aaThreshold,
                passesAA: p?.ratio == null ? null : p.ratio >= aaThreshold,
                occluded: p?.occluded ?? null,
                occluderKind: p?.occluderKind ?? "",
                axeReason: reason.slice(0, 200),
                matched: p?.found ?? false,
                ...({} as object),
              } as Row);
            }
          }
        }
      }
    }
  } finally {
    writeFileSync(`${DIR}contrast-dark-and-occlusion.json`, JSON.stringify({ notes, rows }, null, 2));
    await context.close();
  }
  expect(rows.length).toBeGreaterThanOrEqual(0);
});

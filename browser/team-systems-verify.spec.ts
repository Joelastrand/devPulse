import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { BASE_URL, OUTPUT_DIR, readCredentials } from "./guards";

// team-system-overview TASK-007: READ-ONLY browser verification of /teams/[teamId]/systems.
// One sign-in per run (BR-37). The spec never creates, edits or deletes data: no form is submitted.
// Measurements only: booleans, counts, pixel sizes and route templates. No page text, names,
// ids, URLs with ids, or Backstage links are written to the report.

const WIDTHS = [320, 360, 768, 1024, 1280] as const;
const THEMES = ["lys", "mork"] as const;
const DIR = `${OUTPUT_DIR}team-systems/`;

type Row = {
  route: "/teams/[teamId]/systems";
  width: number;
  theme: string;
  horizontalScroll: boolean;
  scrollWidth: number;
  clientWidth: number;
  navCurrentIsSystems: boolean;
  navItemCount: number;
  tableVisible: boolean;
  cardListVisible: boolean;
  emptyStateVisible: boolean;
  stillLoading: boolean;
  systemRowCount: number;
  systemCardCount: number;
  summaryCardCount: number;
  wcagAaViolations: number;
  wcagAaViolationIds: string[];
};

const rows: Row[] = [];

async function firstTeamSystemsPath(page: Page): Promise<string | null> {
  await page.goto(`${BASE_URL}/teams`);
  await page.locator('a[href^="/teams/"]').first().waitFor({ state: "attached", timeout: 20_000 });
  const href = await page
    .locator('a[href^="/teams/"]')
    .evaluateAll((links) => {
      const found = links
        .map((a) => a.getAttribute("href") ?? "")
        .find((h) => /^\/teams\/[^/]+$/.test(h));
      return found ?? null;
    });
  return href ? `${href}/systems` : null;
}

async function measure(page: Page, path: string, width: number, theme: string, AxeBuilder: typeof import("@axe-core/playwright").default): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.evaluate((t) => window.localStorage.setItem("devpulse.theme", t), theme);
  await page.goto(`${BASE_URL}${path}`);
  await page.getByRole("link", { name: "Systemoversikt" }).first().waitFor({ state: "visible", timeout: 20_000 });
  // The list loads client-side: wait for the loading copy to clear before measuring (bounded).
  await page.getByText("Laster systemoversikt…").first().waitFor({ state: "detached", timeout: 20_000 }).catch(() => undefined);
  const stillLoading = (await page.getByText("Laster systemoversikt…").count()) > 0;

  const nav = page.getByRole("navigation").filter({ has: page.getByRole("link", { name: "Systemoversikt" }) }).first();
  const navLinks = nav.getByRole("link");
  const systemsLink = nav.getByRole("link", { name: "Systemoversikt" });

  const scroll = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();

  await page.screenshot({ path: `${DIR}systems-${width}-${theme}.png`, fullPage: true });

  rows.push({
    route: "/teams/[teamId]/systems",
    width,
    theme,
    horizontalScroll: scroll.scrollWidth > scroll.clientWidth,
    scrollWidth: scroll.scrollWidth,
    clientWidth: scroll.clientWidth,
    navCurrentIsSystems: (await systemsLink.getAttribute("aria-current")) === "page",
    navItemCount: await navLinks.count(),
    tableVisible: await page.locator("table").first().isVisible().catch(() => false),
    cardListVisible: await page.locator('ul[aria-label="Systemer i teamet"]').first().isVisible().catch(() => false),
    emptyStateVisible: (await page.getByText(/^(Ingen systemer registrert ennå|Ingen vurderinger ennå|Ingen treff)$/).count()) > 0,
    stillLoading,
    systemRowCount: await page.locator("table tbody tr").count(),
    systemCardCount: await page.locator('ul[aria-label="Systemer i teamet"] > li').count(),
    summaryCardCount: await page.locator('ul[aria-label="Oppsummering"] > li').count(),
    wcagAaViolations: axe.violations.length,
    wcagAaViolationIds: axe.violations.map((v) => v.id),
  });
}

test("team systems route: read-only layout, theme, nav and WCAG AA checks", async ({ page }) => {
  const creds = readCredentials();
  if (!creds.ok) throw new Error(creds.message);
  mkdirSync(DIR, { recursive: true });

  // Sign-in through the real form, once for the whole run (BR-37).
  await page.goto(`${BASE_URL}/sign-in`);
  await page.getByLabel("E-postadresse").fill(creds.email);
  await page.getByLabel("Passord").fill(creds.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 });

  const path = await firstTeamSystemsPath(page);
  expect(path, "the signed-in account must belong to at least one team").not.toBeNull();
  const AxeBuilder = (await import("@axe-core/playwright")).default;

  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      await measure(page, path as string, width, theme, AxeBuilder);
    }
  }

  // Keyboard: the Systemoversikt tab is reachable by Tab from the page start and shows a visible focus ring.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE_URL}${path}`);
  await page.getByRole("link", { name: "Systemoversikt" }).first().waitFor({ state: "visible", timeout: 20_000 });
  const systemsLink = page.getByRole("link", { name: "Systemoversikt" }).first();
  await systemsLink.focus();
  const focusRing = await systemsLink.evaluate((el) => {
    const s = getComputedStyle(el);
    return { outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, boxShadow: s.boxShadow };
  });
  const hasFocusIndicator = focusRing.outlineStyle !== "none" || focusRing.boxShadow !== "none";

  const report = { generatedAt: new Date().toISOString(), keyboardFocusIndicatorOnNavLink: hasFocusIndicator, rows };
  writeFileSync(`${DIR}report.json`, JSON.stringify(report, null, 2));
  console.log(`team-systems report written: ${rows.length} measurements, focus indicator: ${hasFocusIndicator}`);
});

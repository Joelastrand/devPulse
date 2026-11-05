import { test, expect, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { OUTPUT_DIR, readCredentials } from "./guards";

// TASK-015 bounding-box measurement (BR-22). Signs in once through the real
// sign-in form, then measures /me/conversations with a conversation selected at
// each width and theme. Records element geometry only: no conversation text,
// titles or participant names are written to the report or the JSON output.

const WIDTHS = [320, 360, 768, 1024, 1280] as const;
const THEMES = ["lys", "mork"] as const;
const LEAF_SELECTOR = "h1,h2,h3,h4,p,a,button,input,select,textarea,label,[role=tab],[role=tablist],[role=tabpanel],li,span,dd,dt,time";

/** Collects geometry of visible leaf elements and every overlapping, non-nested pair. */
async function measure(page: Page) {
  return page.evaluate((selector) => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.closest("nav");
    });
    const boxes = els.map((el, index) => {
      const r = el.getBoundingClientRect();
      return {
        index,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role"),
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    });
    const overlaps: { a: number; b: number; area: number }[] = [];
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
        const a = els[i].getBoundingClientRect();
        const b = els[j].getBoundingClientRect();
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ix > 1 && iy > 1) overlaps.push({ a: i, b: j, area: Math.round(ix * iy) });
      }
    }
    const doc = document.documentElement;
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      horizontalScroll: doc.scrollWidth > doc.clientWidth,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      elementCount: boxes.length,
      boxes,
      overlaps,
    };
  }, LEAF_SELECTOR);
}

async function waitSettled(page: Page) {
  // Readiness: the list and detail loading states are gone and the first conversation link is present.
  await page.waitForFunction(() => !document.body.innerText.includes("Laster"), null, { timeout: 30_000 });
}

test("conversation detail overlap measurement (BR-22)", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const creds = readCredentials();
  if (!creds.ok) throw new Error(creds.message);

  await page.goto("/sign-in");
  await page.getByLabel("E-postadresse").fill(creds.email);
  await page.getByLabel("Passord").fill(creds.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 });

  const results: Record<string, unknown>[] = [];
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/me/conversations");
      await page.evaluate((t) => window.localStorage.setItem("devpulse.theme", t), theme === "lys" ? "lys" : "mork");
      await page.reload();
      await waitSettled(page);

      const link = page.locator("main a[href*='/me/conversations/']").first();
      await expect(link).toBeVisible();
      // BR-20 / AD-5 (decision 1, 2026-11-04): the in-place split is used only at xl (1280 px).
      const wide = width >= 1280;
      await link.click();
      // Record where the click landed (BR-21 and AD-5: below xl a navigation to the detail route is expected).
      const detailPath = /\/me\/conversations\/[^/]+$/;
      await page.waitForURL(detailPath, { timeout: 15_000 }).catch(() => undefined);
      const landedOnDetailRoute = detailPath.test(new URL(page.url()).pathname);
      // Readiness: the tab list is in the DOM (attached). Visibility is measured, not asserted, so a collapsed tab list is recorded as a finding.
      await page.locator("[role=tablist]").first().waitFor({ state: "attached", timeout: 15_000 });
      await waitSettled(page);

      const m = await measure(page);
      if (wide) {
        // BR-20: the detail column is at least 480 px wide where the split is used.
        // The detail pane is the child of the list/detail grid that contains the tab list.
        const paneBox = await page.getByTestId("conversation-detail-pane").boundingBox();
        expect(paneBox?.width ?? 0, "detail pane width at >= 1280 px").toBeGreaterThanOrEqual(480);
        // BR-20: the list column is 320–400 px and scrolls inside its own region.
        const listColumn = page.getByTestId("conversation-list-column");
        const listBox = await listColumn.boundingBox();
        expect(listBox?.width ?? 0, "list column width").toBeGreaterThanOrEqual(320);
        expect(listBox?.width ?? 999, "list column width").toBeLessThanOrEqual(400);
        const overflowY = await listColumn.evaluate((el) => getComputedStyle(el).overflowY);
        expect(overflowY, "list column scroll region").toBe("auto");
      }
      const name = `overlap-${theme}-${width}`;
      await page.screenshot({ path: `${OUTPUT_DIR}${name}.png`, fullPage: true });
      results.push({ theme, width, landedOnDetailRoute, wideSplit: wide, ...m });
      console.log(`${theme} ${width}px: detailRoute=${landedOnDetailRoute} elements=${m.elementCount} overlaps=${m.overlaps.length} horizontalScroll=${m.horizontalScroll}`);
    }
  }
  writeFileSync(`${OUTPUT_DIR}conversation-overlap.json`, JSON.stringify(results, null, 2));
});

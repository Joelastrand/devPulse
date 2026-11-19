import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";

// Kanban board in a real browser, against the local Firebase emulators (see kanban-board.emulator.config.ts). The
// account is the synthetic emulator user created by browser/emulator/seed-kanban-verify.mjs. Titles are fictional.
// The emulator keeps data between runs, so every title carries a per-run suffix and no test depends on an empty board.
const EMAIL = "kanban-verify@nve.no";
const PASSWORD = "kanban-verify-synthetic-1";
const OUTPUT = fileURLToPath(new URL("../.verify-output/kanban-screens/", import.meta.url));
mkdirSync(OUTPUT, { recursive: true });
const RUN = Date.now().toString(36);

type Status = "backlog" | "doing" | "blocked" | "done";

async function signIn(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("E-postadresse").fill(EMAIL);
  await page.getByLabel("Passord").fill(PASSWORD);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await page.waitForFunction(() => !window.location.pathname.startsWith("/sign-in"), undefined, { timeout: 30_000 });
}

function column(page: Page, status: Status): Locator {
  return page.locator(`section[data-status="${status}"]`);
}

function card(page: Page, title: string): Locator {
  return page.locator("section[data-status] article").filter({ has: page.getByRole("button", { name: title, exact: true }) });
}

function grip(page: Page, title: string): Locator {
  return page.getByRole("button", { name: `Dra «${title}»`, exact: true });
}

/** Creates a task in Backlog. The inline form stays open after a create, so the add button is used only when closed. */
async function createInBacklog(page: Page, title: string): Promise<void> {
  const backlog = column(page, "backlog");
  const input = backlog.getByPlaceholder("Skriv oppgavetittel …");
  if (!(await input.isVisible())) {
    await backlog.getByRole("button", { name: "Legg til oppgave" }).click();
  }
  await input.fill(title);
  await input.press("Enter");
  await expect(card(page, title)).toBeVisible();
}

/** Pointer drag from the grip to the target, in steps so dnd-kit's 6 px activation constraint is met. */
async function dragWithPointer(page: Page, from: Locator, target: Locator, options: { overColumn?: boolean } = {}): Promise<void> {
  const overColumn = options.overColumn ?? true;
  // The board accumulates tasks across runs, so the grip can sit inside a scrolled column: bring it into view first.
  await from.scrollIntoViewIfNeeded();
  const start = await from.boundingBox();
  const end = await target.boundingBox();
  if (!start || !end) throw new Error("drag endpoints are not visible");
  const sx = start.x + start.width / 2;
  const sy = start.y + start.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 12, sy + 12, { steps: 4 });
  // Aim at the visible part of the target: a tall column can extend above or below the viewport after scrolling.
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  const visibleTop = Math.max(end.y, 0);
  const visibleBottom = Math.min(end.y + end.height, viewport.height);
  const visibleLeft = Math.max(end.x, 0);
  const visibleRight = Math.min(end.x + end.width, viewport.width);
  const aimY = visibleTop + Math.min((visibleBottom - visibleTop) / 2, 80);
  const aimX = (visibleLeft + visibleRight) / 2;
  await page.mouse.move(aimX, aimY, { steps: 25 });
  const dragging = await from.evaluate((element) => element.closest("article")?.getAttribute("data-dragging") ?? null);
  const overTarget = await target.getAttribute("data-drop-over");
  await page.mouse.up();
  // Distinguishes "the drag never started" from "it started but the drop missed" in a failure message.
  expect(dragging, "the source card entered the dragging state before release").toBe("true");
  if (overColumn) expect(overTarget, "the target column was the drop target before release").toBe("true");
}

/** The wanted titles that are in one column, in DOM order (the title button carries no aria-label; the grip does). */
async function orderOf(page: Page, status: Status, wanted: readonly string[]): Promise<string[]> {
  const titles = await column(page, status).locator("article button:not([aria-label])").allTextContents();
  return titles.filter((title) => wanted.includes(title));
}

test.describe.configure({ mode: "serial" });

test.describe("desktop 1440 px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("pointer and keyboard drags move tasks across columns, including an empty column, and survive reload", async ({ page }) => {
    const a = `Kanban A ${RUN}`;
    const b = `Kanban B ${RUN}`;
    const c = `Kanban C ${RUN}`;
    await signIn(page);
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "Backlog" })).toBeVisible();

    await createInBacklog(page, a);
    await createInBacklog(page, b);
    await createInBacklog(page, c);

    // Backlog -> Pågår, pointer.
    await dragWithPointer(page, grip(page, a), column(page, "doing"));
    await expect(column(page, "doing").getByRole("button", { name: a, exact: true })).toBeVisible();

    // Empty column (Blokkert has no cards in this run's board), pointer.
    await dragWithPointer(page, grip(page, b), column(page, "blocked"));
    await expect(column(page, "blocked").getByRole("button", { name: b, exact: true })).toBeVisible();

    // Keyboard: focus the grip, pick up, move right until Pågår is the drop target (its data-drop-over flag), drop.
    // The card's DOM position changes only on drop, so the drop target is the signal during the drag.
    await grip(page, c).focus();
    await page.keyboard.press("Space");
    let overDoing = false;
    for (let step = 0; step < 4 && !overDoing; step += 1) {
      await page.keyboard.press("ArrowRight");
      try {
        await expect(column(page, "doing")).toHaveAttribute("data-drop-over", "true", { timeout: 1_000 });
        overDoing = true;
      } catch {
        overDoing = false;
      }
    }
    expect(overDoing, "Pågår became the keyboard drop target").toBe(true);
    await page.keyboard.press("Space");
    await expect(column(page, "doing").getByRole("button", { name: c, exact: true })).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(column(page, "doing").getByRole("button", { name: c, exact: true })).toBeVisible();
    await expect(column(page, "blocked").getByRole("button", { name: b, exact: true })).toBeVisible();
  });

  test("a rejected move rolls back to its column, and the status select still moves the task", async ({ page }) => {
    const d = `Kanban D ${RUN}`;
    await signIn(page);
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "Backlog" })).toBeVisible();
    await createInBacklog(page, d);

    await page.route("**/api/me/tasks/*", async (route) => {
      if (route.request().method() === "PATCH") {
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "persistence_failed" }) });
      } else {
        await route.continue();
      }
    });
    await dragWithPointer(page, grip(page, d), column(page, "doing"));
    // The board's own alert (not the route announcer): a failed save is reported as "cannot confirm", never as success.
    await expect(page.locator('p[role="alert"]')).toContainText("Vi kan ikke bekrefte at endringen");
    await expect(column(page, "backlog").getByRole("button", { name: d, exact: true })).toBeVisible();
    await expect(column(page, "doing").getByRole("button", { name: d, exact: true })).toHaveCount(0);
    await page.unroute("**/api/me/tasks/*");

    await card(page, d).getByRole("combobox").selectOption("doing");
    await expect(column(page, "doing").getByRole("button", { name: d, exact: true })).toBeVisible();
  });

  test("the drag overlay is display-only: no grip, select or buttons while dragging", async ({ page }) => {
    const e = `Kanban E ${RUN}`;
    await signIn(page);
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "Backlog" })).toBeVisible();
    await createInBacklog(page, e);

    await grip(page, e).scrollIntoViewIfNeeded();
    const start = await grip(page, e).boundingBox();
    if (!start) throw new Error("grip not visible");
    const sx = start.x + start.width / 2;
    const sy = start.y + start.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 20, sy + 30, { steps: 8 });
    // The source card is marked while dragged; only then is the overlay expected to exist.
    await expect(card(page, e)).toHaveAttribute("data-dragging", "true");
    const overlay = page.locator('[aria-hidden="true"]').filter({ hasText: e }).last();
    await expect(overlay).toBeVisible();
    expect(await overlay.locator("button, select, a, input").count()).toBe(0);
    await page.mouse.up();
  });

  test("the grip has a Norwegian label and a visible focus ring, and the title still opens the editor", async ({ page }) => {
    const f = `Kanban F ${RUN}`;
    await signIn(page);
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "Backlog" })).toBeVisible();
    await createInBacklog(page, f);

    await grip(page, f).focus();
    await expect(grip(page, f)).toBeFocused();
    const outline = await grip(page, f).evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(outline).not.toBe("none");

    await card(page, f).getByRole("button", { name: f, exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("the drag instructions are present for screen readers, in Norwegian", async ({ page }) => {
    await signIn(page);
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "Backlog" })).toBeVisible();
    await expect(page.getByText("Trykk mellomrom eller Enter for å løfte oppgaven", { exact: false }).first()).toBeAttached();
  });
});

test.describe("reordering and cancel at 1440 px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("dragging a card onto another card in the same column reorders them, and the order survives reload", async ({ page }) => {
    const x = `Kanban X ${RUN}`;
    const y = `Kanban Y ${RUN}`;
    const z = `Kanban Z ${RUN}`;
    await signIn(page);
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "Backlog" })).toBeVisible();
    await createInBacklog(page, x);
    await createInBacklog(page, y);
    await createInBacklog(page, z);
    expect(await orderOf(page, "backlog", [x, y, z])).toEqual([x, y, z]);

    // Move Z up onto X: Z must land before X.
    await dragWithPointer(page, grip(page, z), card(page, x), { overColumn: false });
    await expect.poll(() => orderOf(page, "backlog", [x, y, z])).toEqual([z, x, y]);

    await page.reload();
    await expect.poll(() => orderOf(page, "backlog", [x, y, z])).toEqual([z, x, y]);
  });

  test("pressing Escape while dragging cancels: the task stays where it was", async ({ page }) => {
    const w = `Kanban W ${RUN}`;
    await signIn(page);
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "Backlog" })).toBeVisible();
    await createInBacklog(page, w);

    await grip(page, w).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    await expect(column(page, "backlog").getByRole("button", { name: w, exact: true })).toBeVisible();
    await expect(column(page, "doing").getByRole("button", { name: w, exact: true })).toHaveCount(0);
  });
});

test.describe("layout at 375, 768 and 1440 px, light and dark", () => {
  for (const width of [375, 768, 1440] as const) {
    for (const scheme of ["light", "dark"] as const) {
      test(`${width} px ${scheme}: no horizontal page overflow`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme });
        await signIn(page);
        await page.goto("/tasks");
        await expect(page.getByRole("heading", { name: "Backlog" })).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        await page.screenshot({ path: `${OUTPUT}board-${width}-${scheme}.png`, fullPage: true });
      });
    }
  }
});

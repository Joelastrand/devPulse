import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { BASE_URL, OUTPUT_DIR, readCredentials } from "./guards";

// visual-fidelity-and-ui-fixes TASK-021: mouse sign-out from the account menu at one width per run.
// One real sign-in per run (BR-37). The width is set by VERIFY_SIGNOUT_WIDTH (320 or 768; default 320).
// Records final URL, signed-out navigation state, and whether the account menu disappears.
// The report holds no page text, names or cookies.

const WIDTH = Number(process.env.VERIFY_SIGNOUT_WIDTH ?? "320");
const DIR = `${OUTPUT_DIR}a11y/`;

test("mouse sign-out from the account menu at one width", async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(DIR, { recursive: true });
  const creds = readCredentials();
  if (!creds.ok) throw new Error(creds.message);
  const outcome: Record<string, unknown> = { width: WIDTH, input: "mouse" };
  try {
    await page.setViewportSize({ width: WIDTH, height: 900 });
    await page.goto(`${BASE_URL}/sign-in`);
    await page.getByLabel("E-postadresse").fill(creds.email);
    await page.getByLabel("Passord").fill(creds.password);
    await page.getByRole("button", { name: "Logg inn" }).click();
    await page.waitForFunction(() => !window.location.pathname.startsWith("/sign-in"), undefined, {
      timeout: 60_000,
      polling: 250,
    });
    outcome.landingAfterSignIn = new URL(page.url()).pathname;
    await page.waitForLoadState("load");
    const trigger = page.locator('button[aria-haspopup="true"]').first();
    await trigger.waitFor({ state: "visible", timeout: 30_000 });
    const triggerBox = await trigger.boundingBox();
    outcome.triggerHeightPx = triggerBox ? Math.round(triggerBox.height) : null;
    await trigger.click();
    const signOut = page.getByRole("menuitem", { name: "Logg ut" }).or(page.getByRole("button", { name: "Logg ut" })).first();
    await signOut.waitFor({ state: "visible", timeout: 10_000 });
    outcome.menuOpenedByMouse = true;
    await signOut.click();
    await page.getByRole("link", { name: "Logg inn" }).first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(1000);
    outcome.finalPath = new URL(page.url()).pathname;
    outcome.accountTriggerPresent = (await page.locator('button[aria-haspopup="true"]').count()) > 0;
    outcome.signInLinkPresent = (await page.getByRole("link", { name: "Logg inn" }).count()) > 0;
    outcome.signOutControlPresent = (await page.getByText("Logg ut", { exact: true }).count()) > 0;
    // Reload: the session must stay signed out.
    await page.reload();
    await page.waitForLoadState("load");
    await page.waitForTimeout(1500);
    outcome.afterReloadPath = new URL(page.url()).pathname;
    outcome.afterReloadSignedOut = (await page.locator('button[aria-haspopup="true"]').count()) === 0;
  } finally {
    writeFileSync(`${DIR}signout-mouse-w${WIDTH}.json`, JSON.stringify(outcome, null, 2));
  }
  expect(outcome.finalPath).toBeDefined();
});

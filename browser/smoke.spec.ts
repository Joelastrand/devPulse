import { test, expect } from "@playwright/test";
import { OUTPUT_DIR, readCredentials } from "./guards";

// TASK-001 smoke run. Signs in once through the real sign-in form with the
// owner's test account (runtime env vars). Never logs or stores credentials,
// cookies or tokens. Screenshots go to the git-ignored output directory.

test("signed-out home renders and signed-in landing is captured", async ({ page }, testInfo) => {
  const creds = readCredentials();
  if (!creds.ok) throw new Error(creds.message);

  await page.goto("/");
  await expect(page.locator("h1").first()).toBeVisible();
  await page.screenshot({ path: `${OUTPUT_DIR}smoke-signed-out-home.png`, fullPage: true });

  await page.goto("/sign-in");
  await page.getByLabel("E-postadresse").fill(creds.email);
  await page.getByLabel("Passord").fill(creds.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 });

  const landing = new URL(page.url()).pathname;
  testInfo.annotations.push({ type: "landing-path", description: landing });
  await page.screenshot({ path: `${OUTPUT_DIR}smoke-signed-in-landing.png`, fullPage: true });
  console.log(`Signed-in landing path: ${landing}`);
});

import { expect, test, type Page } from "@playwright/test";

/**
 * Email-verification flow on the local Firebase Auth emulator (demo project only). No real account is used. The emulator
 * base URL and the demo project id are fixed here and checked before any request is made, so the spec cannot reach a
 * real project.
 */

const AUTH_EMULATOR = "http://127.0.0.1:9099";
const PROJECT = "demo-devpulse-verify";
const PASSWORD = "correct horse battery 1";
const OWNER_HEADERS = { Authorization: "Bearer owner", "Content-Type": "application/json" };

function uniqueNveEmail(): string {
  return `verify-${Date.now()}-${Math.floor(Math.random() * 1e6)}@nve.no`;
}

/** Marks the account's address as verified in the emulator, the way clicking the link would. */
async function verifyEmailInEmulator(request: import("@playwright/test").APIRequestContext, email: string): Promise<void> {
  const lookup = await request.post(`${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`, {
    headers: OWNER_HEADERS,
    data: { email: [email] },
  });
  const body = (await lookup.json()) as { users?: { localId: string }[] };
  const localId = body.users?.[0]?.localId;
  expect(localId, "the test account exists in the emulator").toBeTruthy();
  const update = await request.post(`${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, {
    headers: OWNER_HEADERS,
    data: { localId, emailVerified: true },
  });
  expect(update.ok()).toBe(true);
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("sign-up shows the verification instructions, the spam reminder, a resend action and a working login button", async ({ page }) => {
  const email = uniqueNveEmail();
  await page.goto("/sign-up");
  await page.getByLabel("E-post").fill(email);
  await page.getByLabel("Passord").fill(PASSWORD);
  await page.getByRole("button", { name: "Opprett konto" }).click();

  await expect(page.getByRole("heading", { name: "Sjekk e-posten din" })).toBeVisible();
  await expect(page.getByText(/Åpne lenken for å aktivere kontoen din/)).toBeVisible();
  await expect(page.getByText(/søppelpost eller spam-mappen/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Send bekreftelseslenke på nytt" })).toBeEnabled();
  await expectNoHorizontalScroll(page);

  await page.getByRole("button", { name: "Logg inn" }).click();
  await page.waitForURL(/\/sign-in/, { timeout: 15_000 });
  await expect(page.getByLabel("E-postadresse")).toBeVisible();
});

test("resend is sent once, then disabled for the cooldown", async ({ page }) => {
  const email = uniqueNveEmail();
  await page.goto("/sign-up");
  await page.getByLabel("E-post").fill(email);
  await page.getByLabel("Passord").fill(PASSWORD);
  await page.getByRole("button", { name: "Opprett konto" }).click();
  await expect(page.getByRole("heading", { name: "Sjekk e-posten din" })).toBeVisible();

  await page.getByRole("button", { name: "Send bekreftelseslenke på nytt" }).click();
  await expect(page.getByRole("status").filter({ hasText: "er en ny lenke sendt" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Send bekreftelseslenke på nytt/ })).toBeDisabled();
});

test("an unverified account is told to verify, and after verification it can log in", async ({ page, request }) => {
  const email = uniqueNveEmail();
  await page.goto("/sign-up");
  await page.getByLabel("E-post").fill(email);
  await page.getByLabel("Passord").fill(PASSWORD);
  await page.getByRole("button", { name: "Opprett konto" }).click();
  await expect(page.getByRole("heading", { name: "Sjekk e-posten din" })).toBeVisible();

  // Log out through the login button, then sign in while still unverified.
  await page.getByRole("button", { name: "Logg inn" }).click();
  await page.waitForURL(/\/sign-in/);
  await page.getByLabel("E-postadresse").fill(email);
  await page.getByLabel("Passord").fill(PASSWORD);
  await page.getByRole("button", { name: "Logg inn" }).click();

  await expect(page.getByRole("heading", { name: "Bekreft e-posten din først" })).toBeVisible();
  await expect(page.getByText("Ugyldig e-post eller passord.")).toHaveCount(0);

  // Verify the address (the emulator equivalent of clicking the link), then log in again from a clean session.
  await verifyEmailInEmulator(request, email);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await page.waitForURL(/\/sign-in/);
  await page.getByLabel("E-postadresse").fill(email);
  await page.getByLabel("Passord").fill(PASSWORD);
  await page.getByRole("button", { name: "Logg inn" }).click();

  await expect(page.getByText("Du er logget inn.")).toBeVisible({ timeout: 20_000 });
});

test("the verification screen fits a phone-width viewport and stays keyboard-operable", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto("/sign-up");
  await page.getByLabel("E-post").fill(uniqueNveEmail());
  await page.getByLabel("Passord").fill(PASSWORD);
  await page.getByRole("button", { name: "Opprett konto" }).click();
  await expect(page.getByRole("heading", { name: "Sjekk e-posten din" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  expect(["BUTTON", "A", "INPUT"]).toContain(focused);
});

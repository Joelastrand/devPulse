# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: email-verification.spec.ts >> sign-up shows the verification instructions, the spam reminder, a resend action and a working login button
- Location: browser\email-verification.spec.ts:39:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'Sjekk e-posten din' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('heading', { name: 'Sjekk e-posten din' }) with timeout 5000ms
  - waiting for getByRole('heading', { name: 'Sjekk e-posten din' })

```

```yaml
- link "Hopp til innhold":
  - /url: "#main-content"
- banner:
  - text: DevPulse
  - navigation "Hovednavigasjon":
    - list:
      - listitem:
        - link "Hjem":
          - /url: /
      - listitem:
        - link "Logg inn":
          - /url: /sign-in
      - listitem:
        - link "Opprett konto":
          - /url: /sign-up
- main:
  - heading "Opprett konto" [level=1]
  - paragraph: Du må bekrefte e-posten din før teamets dashbord blir tilgjengelig.
  - status: Konto opprettet. Sjekk e-posten din for en bekreftelseslenke — du må bekrefte e-posten din før teamets dashbord blir tilgjengelig.
- alert
```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | 
  3   | /**
  4   |  * Email-verification flow on the local Firebase Auth emulator (demo project only). No real account is used. The emulator
  5   |  * base URL and the demo project id are fixed here and checked before any request is made, so the spec cannot reach a
  6   |  * real project.
  7   |  */
  8   | 
  9   | const AUTH_EMULATOR = "http://127.0.0.1:9099";
  10  | const PROJECT = "demo-devpulse-verify";
  11  | const PASSWORD = "correct horse battery 1";
  12  | const OWNER_HEADERS = { Authorization: "Bearer owner", "Content-Type": "application/json" };
  13  | 
  14  | function uniqueNveEmail(): string {
  15  |   return `verify-${Date.now()}-${Math.floor(Math.random() * 1e6)}@nve.no`;
  16  | }
  17  | 
  18  | /** Marks the account's address as verified in the emulator, the way clicking the link would. */
  19  | async function verifyEmailInEmulator(request: import("@playwright/test").APIRequestContext, email: string): Promise<void> {
  20  |   const lookup = await request.post(`${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`, {
  21  |     headers: OWNER_HEADERS,
  22  |     data: { email: [email] },
  23  |   });
  24  |   const body = (await lookup.json()) as { users?: { localId: string }[] };
  25  |   const localId = body.users?.[0]?.localId;
  26  |   expect(localId, "the test account exists in the emulator").toBeTruthy();
  27  |   const update = await request.post(`${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, {
  28  |     headers: OWNER_HEADERS,
  29  |     data: { localId, emailVerified: true },
  30  |   });
  31  |   expect(update.ok()).toBe(true);
  32  | }
  33  | 
  34  | async function expectNoHorizontalScroll(page: Page): Promise<void> {
  35  |   const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  36  |   expect(overflow).toBeLessThanOrEqual(0);
  37  | }
  38  | 
  39  | test("sign-up shows the verification instructions, the spam reminder, a resend action and a working login button", async ({ page }) => {
  40  |   const email = uniqueNveEmail();
  41  |   await page.goto("/sign-up");
  42  |   await page.getByLabel("E-post").fill(email);
  43  |   await page.getByLabel("Passord").fill(PASSWORD);
  44  |   await page.getByRole("button", { name: "Opprett konto" }).click();
  45  | 
> 46  |   await expect(page.getByRole("heading", { name: "Sjekk e-posten din" })).toBeVisible();
      |                                                                           ^ Error: expect(locator).toBeVisible() failed
  47  |   await expect(page.getByText(/Åpne lenken for å aktivere kontoen din/)).toBeVisible();
  48  |   await expect(page.getByText(/søppelpost eller spam-mappen/)).toBeVisible();
  49  |   await expect(page.getByRole("button", { name: "Send bekreftelseslenke på nytt" })).toBeEnabled();
  50  |   await expectNoHorizontalScroll(page);
  51  | 
  52  |   await page.getByRole("button", { name: "Logg inn" }).click();
  53  |   await page.waitForURL(/\/sign-in/, { timeout: 15_000 });
  54  |   await expect(page.getByLabel("E-postadresse")).toBeVisible();
  55  | });
  56  | 
  57  | test("resend is sent once, then disabled for the cooldown", async ({ page }) => {
  58  |   const email = uniqueNveEmail();
  59  |   await page.goto("/sign-up");
  60  |   await page.getByLabel("E-post").fill(email);
  61  |   await page.getByLabel("Passord").fill(PASSWORD);
  62  |   await page.getByRole("button", { name: "Opprett konto" }).click();
  63  |   await expect(page.getByRole("heading", { name: "Sjekk e-posten din" })).toBeVisible();
  64  | 
  65  |   await page.getByRole("button", { name: "Send bekreftelseslenke på nytt" }).click();
  66  |   await expect(page.getByRole("status").filter({ hasText: "en ny lenke er sendt" })).toBeVisible();
  67  |   await expect(page.getByRole("button", { name: /Send bekreftelseslenke på nytt/ })).toBeDisabled();
  68  | });
  69  | 
  70  | test("an unverified account is told to verify, and after verification it can log in", async ({ page, request }) => {
  71  |   const email = uniqueNveEmail();
  72  |   await page.goto("/sign-up");
  73  |   await page.getByLabel("E-post").fill(email);
  74  |   await page.getByLabel("Passord").fill(PASSWORD);
  75  |   await page.getByRole("button", { name: "Opprett konto" }).click();
  76  |   await expect(page.getByRole("heading", { name: "Sjekk e-posten din" })).toBeVisible();
  77  | 
  78  |   // Log out through the login button, then sign in while still unverified.
  79  |   await page.getByRole("button", { name: "Logg inn" }).click();
  80  |   await page.waitForURL(/\/sign-in/);
  81  |   await page.getByLabel("E-postadresse").fill(email);
  82  |   await page.getByLabel("Passord").fill(PASSWORD);
  83  |   await page.getByRole("button", { name: "Logg inn" }).click();
  84  | 
  85  |   await expect(page.getByRole("heading", { name: "Bekreft e-posten din først" })).toBeVisible();
  86  |   await expect(page.getByText("Ugyldig e-post eller passord.")).toHaveCount(0);
  87  | 
  88  |   // Verify the address (the emulator equivalent of clicking the link), then log in again from a clean session.
  89  |   await verifyEmailInEmulator(request, email);
  90  |   await page.getByRole("button", { name: "Logg inn" }).click();
  91  |   await page.waitForURL(/\/sign-in/);
  92  |   await page.getByLabel("E-postadresse").fill(email);
  93  |   await page.getByLabel("Passord").fill(PASSWORD);
  94  |   await page.getByRole("button", { name: "Logg inn" }).click();
  95  | 
  96  |   await expect(page.getByText("Du er logget inn.")).toBeVisible({ timeout: 20_000 });
  97  | });
  98  | 
  99  | test("the verification screen fits a phone-width viewport and stays keyboard-operable", async ({ page }) => {
  100 |   await page.setViewportSize({ width: 375, height: 740 });
  101 |   await page.goto("/sign-up");
  102 |   await page.getByLabel("E-post").fill(uniqueNveEmail());
  103 |   await page.getByLabel("Passord").fill(PASSWORD);
  104 |   await page.getByRole("button", { name: "Opprett konto" }).click();
  105 |   await expect(page.getByRole("heading", { name: "Sjekk e-posten din" })).toBeVisible();
  106 |   await expectNoHorizontalScroll(page);
  107 | 
  108 |   await page.keyboard.press("Tab");
  109 |   const focused = await page.evaluate(() => document.activeElement?.tagName);
  110 |   expect(["BUTTON", "A", "INPUT"]).toContain(focused);
  111 | });
  112 | 
```
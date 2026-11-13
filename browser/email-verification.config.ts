import { defineConfig, devices } from "@playwright/test";

/**
 * Local-emulator browser checks for the email-verification flow. Separate from the owner-account harness
 * (`playwright.config.ts`), which signs in to a real project. This config never reads .env.local and runs only against a
 * dev server started with emulator-only environment (see docs/DEVELOPMENT.md, "Browser checks on the emulators").
 */
export default defineConfig({
  testDir: ".",
  testMatch: /email-verification\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3101",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

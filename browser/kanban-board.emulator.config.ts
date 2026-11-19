import { defineConfig, devices } from "@playwright/test";

// Kanban browser checks against the LOCAL Firebase emulators only. The run refuses to start unless the base URL is a
// localhost origin and the emulator project id starts with "demo-". It does not use the live-credential global setup of
// playwright.config.ts, so no owner account or production setting is read.
const base = process.env.DEVPULSE_KANBAN_BASE_URL ?? "";
const project = process.env.DEVPULSE_KANBAN_PROJECT ?? "";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/.test(base)) {
  throw new Error("REFUSED: DEVPULSE_KANBAN_BASE_URL must be a localhost http origin (emulator-backed dev server).");
}
if (!project.startsWith("demo-")) {
  throw new Error("REFUSED: DEVPULSE_KANBAN_PROJECT must be a demo- emulator project.");
}

export default defineConfig({
  testDir: ".",
  testMatch: /kanban-board\.emulator\.spec\.ts$/,
  outputDir: "../.verify-output/kanban-test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [["list"]],
  use: {
    baseURL: base,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

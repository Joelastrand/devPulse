import { mkdirSync, rmSync } from "node:fs";
import { checkProjectIsNotProduction, configuredFirebaseProjectId, OUTPUT_DIR, readCredentials } from "./guards";

// Runs once before any browser test. Stops the whole run when the runtime
// credentials are missing or the configured Firebase project is production.
export default async function globalSetup(): Promise<void> {
  const creds = readCredentials();
  if (!creds.ok) {
    throw new Error(creds.message);
  }
  const project = checkProjectIsNotProduction(configuredFirebaseProjectId());
  if (!project.ok) {
    throw new Error(project.message);
  }
  // Clear Playwright artefacts from an earlier run (an aborted run skips teardown and can keep error context).
  rmSync(`${OUTPUT_DIR}test-results`, { recursive: true, force: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

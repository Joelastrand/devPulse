import { rmSync } from "node:fs";
import { OUTPUT_DIR } from "./guards";

// Playwright writes failure output (error-context.md) that includes form field
// values, which would contain the owner's password. Remove it after every run,
// including failed runs (BR-37, TASK-001). Screenshots in OUTPUT_DIR are kept.
export default async function globalTeardown(): Promise<void> {
  rmSync(`${OUTPUT_DIR}test-results`, { recursive: true, force: true });
}

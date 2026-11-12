import { vi } from "vitest";
import { toPersistedSurvey } from "./survey-content-codec";

/**
 * Test-only helpers for persisted survey documents. Stored surveys carry their authored content sealed, so a fixture that
 * seeds a fake store must be built with the same codec the production read path opens. Call `stubSurveyEncryptionKey()`
 * in `beforeEach` before building a fixture, so the seal and the open use the same key.
 */
const TEST_KEY_BYTES = Buffer.alloc(32, 7);

export function stubSurveyEncryptionKey(): void {
  vi.stubEnv("ENCRYPTION_KEY", TEST_KEY_BYTES.toString("base64"));
}

/** A survey document as stored: plaintext metadata plus the sealed `content` envelope. */
export function persistedSurveyFixture(surveyId: string, plain: Record<string, unknown>): Record<string, unknown> {
  return toPersistedSurvey(surveyId, plain);
}

/**
 * Seeds a fake store: a `surveys/{id}` entry is stored sealed, every other path is stored as given. The seal uses the
 * key the test has configured, so the test must set `ENCRYPTION_KEY` (see `stubSurveyEncryptionKey`) before seeding.
 */
export function sealSeedDocument(path: string, data: Record<string, unknown>): Record<string, unknown> {
  if (!path.startsWith("surveys/")) return data;
  return persistedSurveyFixture(path.slice("surveys/".length), data);
}

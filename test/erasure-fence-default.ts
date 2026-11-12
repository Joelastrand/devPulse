import { randomBytes } from "node:crypto";
import { vi } from "vitest";

/**
 * Synthetic test-only master key for application-layer encryption. It is generated per run, never stored, and only set
 * when the environment has no key. Tests that need a missing or invalid key stub `ENCRYPTION_KEY` explicitly.
 */
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
}

/**
 * Test default for the erasure fence (TASK-009). Production reads `accountErasures/{uid}` from Firestore
 * (src/features/auth/server/erasure-fence.ts). Feature tests inject a fake database and do not model that record, so every
 * test sees "no erasure record" by default. The real reader is covered by erasure-fence.test.ts and
 * verify-identity-fence.test.ts, which unmock it. Product code is not changed by this file.
 */
vi.mock("../src/features/auth/server/erasure-fence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/features/auth/server/erasure-fence")>()),
  readErasureFenceFromFirestore: async () => ({ kind: "none" }),
}));

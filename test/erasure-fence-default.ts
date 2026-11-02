import { vi } from "vitest";

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

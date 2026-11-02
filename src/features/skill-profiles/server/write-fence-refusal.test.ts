import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// TASK-025: a refused skill-profile write is reported as `erasure_in_progress`, not as a generic failure. Any other write
// failure stays `persistence_failed`. Fixtures are synthetic.

import { ErasureWriteRefused } from "../../auth/server/erasure-write-fence";
import { clearOwnSkillLevel } from "./clear-own-skill-level";
import { deleteOwnSkillProfile } from "./delete-own-skill-profile";
import { setOwnSkillLevel } from "./set-own-skill-level";
import { createFakeSkillProfileStore } from "./fake-skill-profile-store";

type SkillProfileStore = ReturnType<typeof createFakeSkillProfileStore>["store"];

const TREE_ID = "tree-1";
const verifyToken = vi.fn().mockResolvedValue({ uid: "user-1", email: "synthetic@example.com", email_verified: true });

/** The fake store with every write refused by the erasure fence, or failing generically. */
function writeBlocked(failure: unknown): SkillProfileStore {
  const { store } = createFakeSkillProfileStore({}, {});
  return {
    ...store,
    runTransaction: async () => {
      throw failure;
    },
    delete: async () => {
      throw failure;
    },
  };
}

const VALID_BODY = { level: 2 };

// These tests cover the error mapping only. The fence read itself is proven against the real default store in
// collection-independence.test.ts, because this fake store does not enforce the fence.
describe("skill-profile write error mapping (TASK-025)", () => {
  it("setOwnSkillLevel reports a fence refusal as erasure_in_progress", async () => {
    const result = await setOwnSkillLevel("token", TREE_ID, VALID_BODY, {
      verifyToken,
      store: writeBlocked(new ErasureWriteRefused()),
    });
    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
  });

  it("clearOwnSkillLevel reports a fence refusal as erasure_in_progress", async () => {
    const result = await clearOwnSkillLevel("token", TREE_ID, { verifyToken, store: writeBlocked(new ErasureWriteRefused()) });
    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
  });

  it("deleteOwnSkillProfile reports a fence refusal as erasure_in_progress", async () => {
    const result = await deleteOwnSkillProfile("token", { verifyToken, store: writeBlocked(new ErasureWriteRefused()) });
    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
  });

  it("keeps a generic write failure as persistence_failed on every write", async () => {
    const failure = new Error("firestore unavailable");
    expect(await setOwnSkillLevel("token", TREE_ID, VALID_BODY, { verifyToken, store: writeBlocked(failure) })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(await clearOwnSkillLevel("token", TREE_ID, { verifyToken, store: writeBlocked(failure) })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(await deleteOwnSkillProfile("token", { verifyToken, store: writeBlocked(failure) })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
  });
});

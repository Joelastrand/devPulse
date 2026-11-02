import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// TASK-025: a refused profile write is reported as `erasure_in_progress`, not as a generic failure. Any other write failure
// stays `persistence_failed`. Fixtures are synthetic.

import { ErasureWriteRefused } from "../../auth/server/erasure-write-fence";
import { deleteOwnProfile } from "./delete-own-profile";
import { setOwnProfile } from "./set-own-profile";
import type { UserProfileStore } from "./user-profile-store";

const verifyToken = vi.fn().mockResolvedValue({ uid: "user-1", email: "synthetic@example.com", email_verified: true });

function refusingStore(): UserProfileStore {
  return {
    read: async () => undefined,
    upsert: async () => {
      throw new ErasureWriteRefused();
    },
    remove: async () => {
      throw new ErasureWriteRefused();
    },
  };
}

function failingStore(): UserProfileStore {
  return {
    read: async () => undefined,
    upsert: async () => {
      throw new Error("firestore unavailable");
    },
    remove: async () => {
      throw new Error("firestore unavailable");
    },
  };
}

describe("profile writes during erasure (TASK-025)", () => {
  it("setOwnProfile reports a fence refusal as erasure_in_progress", async () => {
    const result = await setOwnProfile("token", "Synthetic Name", { verifyToken, store: refusingStore() });
    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
  });

  it("deleteOwnProfile reports a fence refusal as erasure_in_progress", async () => {
    const result = await deleteOwnProfile("token", { verifyToken, store: refusingStore() });
    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
  });

  it("setOwnProfile keeps a generic failure as persistence_failed, without the raw error", async () => {
    const result = await setOwnProfile("token", "Synthetic Name", { verifyToken, store: failingStore() });
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("deleteOwnProfile keeps a generic failure as persistence_failed", async () => {
    const result = await deleteOwnProfile("token", { verifyToken, store: failingStore() });
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });
});

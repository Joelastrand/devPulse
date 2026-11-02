import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// TASK-025: the production `userProfiles` writers read `accountErasures/{uid}` inside their own transaction (BR-4(b)).
// These tests use a Firestore-shaped fake behind the Admin SDK seam. They prove the fence read goes through the
// transaction, a refused write mutates nothing, and an absent record leaves the write unchanged. Fixtures are synthetic.

const fake = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("../../../lib/firebase/admin", () => ({ getFirestoreDb: () => fake.db }));

import { ErasureWriteRefused } from "../../auth/server/erasure-write-fence";
import { getDefaultUserProfileStore } from "./user-profile-store";

const UID = "user-1";
const PROFILE_PATH = `userProfiles/${UID}`;
const FENCE_PATH = `accountErasures/${UID}`;

interface Ops {
  writes: string[];
  plainGets: string[];
}

/** A fake Firestore. `records` maps a document path to its data; a path present in `records` exists. */
function installFakeDb(records: Record<string, unknown>): Ops {
  const ops: Ops = { writes: [], plainGets: [] };
  const exists = (path: string) => Object.hasOwn(records, path);
  const tx = {
    get: async (ref: { path: string }) => ({ exists: exists(ref.path), data: () => records[ref.path] }),
    set: (ref: { path: string }) => {
      ops.writes.push(`set:${ref.path}`);
    },
    delete: (ref: { path: string }) => {
      ops.writes.push(`delete:${ref.path}`);
    },
  };
  fake.db = {
    collection: (name: string) => ({
      doc: (id: string) => ({
        path: `${name}/${id}`,
        get: async () => {
          ops.plainGets.push(`${name}/${id}`);
          throw new Error("plain document get must not be used by a write");
        },
      }),
    }),
    runTransaction: async <T>(work: (t: typeof tx) => Promise<T>) => work(tx),
  };
  return ops;
}

describe("userProfiles writers: erasure fence (TASK-025)", () => {
  beforeEach(() => {
    fake.db = undefined;
  });

  it("upsert with no erasure record writes the profile and passes the existing data to the builder", async () => {
    const ops = installFakeDb({});
    const build = vi.fn(() => ({ displayName: "Synthetic" }));

    await getDefaultUserProfileStore().upsert(UID, build);

    expect(build).toHaveBeenCalledWith(undefined);
    expect(ops.writes).toEqual([`set:${PROFILE_PATH}`]);
  });

  it("upsert with an erasure record refuses and writes nothing", async () => {
    const ops = installFakeDb({ [FENCE_PATH]: { status: "in_progress" }, [PROFILE_PATH]: { displayName: "Old" } });

    await expect(getDefaultUserProfileStore().upsert(UID, () => ({ displayName: "New" }))).rejects.toBeInstanceOf(ErasureWriteRefused);
    expect(ops.writes).toEqual([]);
  });

  it("upsert fails closed on a malformed erasure record", async () => {
    const ops = installFakeDb({ [FENCE_PATH]: "not-a-record" });

    await expect(getDefaultUserProfileStore().upsert(UID, () => ({ displayName: "New" }))).rejects.toBeInstanceOf(ErasureWriteRefused);
    expect(ops.writes).toEqual([]);
  });

  it("remove with no erasure record deletes the profile", async () => {
    const ops = installFakeDb({ [PROFILE_PATH]: { displayName: "Synthetic" } });

    await getDefaultUserProfileStore().remove(UID);

    expect(ops.writes).toEqual([`delete:${PROFILE_PATH}`]);
  });

  it("remove with an erasure record refuses and deletes nothing", async () => {
    const ops = installFakeDb({ [FENCE_PATH]: { status: "in_progress" }, [PROFILE_PATH]: { displayName: "Synthetic" } });

    await expect(getDefaultUserProfileStore().remove(UID)).rejects.toBeInstanceOf(ErasureWriteRefused);
    expect(ops.writes).toEqual([]);
  });

  it("reads the fence through the transaction, never with a plain document get", async () => {
    const ops = installFakeDb({});

    await getDefaultUserProfileStore().remove(UID);
    await getDefaultUserProfileStore().upsert(UID, () => ({ displayName: "Synthetic" }));

    expect(ops.plainGets).toEqual([]);
  });
});

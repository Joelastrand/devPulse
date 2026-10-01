import { describe, expect, it, vi } from "vitest";
import { DISPLAY_NAME_BATCH_SIZE, getDisplayNames, type ProfileBatchReader } from "./get-display-names";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const T = new Date("2026-01-01T00:00:00Z");
const profile = (displayName: string) => ({ displayName, createdAt: T, updatedAt: T });

function fakeReader(docs: Record<string, unknown>) {
  const batches: string[][] = [];
  const reader: ProfileBatchReader = {
    async readBatch(uids) {
      batches.push([...uids]);
      return uids.map((uid) => ({ uid, data: docs[uid] }));
    },
  };
  return { reader, batches };
}

describe("getDisplayNames", () => {
  it("returns the names of members that have a valid profile, and nothing for those without", async () => {
    const { reader } = fakeReader({ "user-1": profile("Anna Berg"), "user-3": profile("Bo Lind") });

    const names = await getDisplayNames(["user-1", "user-2", "user-3"], { reader });

    expect(names.get("user-1")).toBe("Anna Berg");
    expect(names.get("user-3")).toBe("Bo Lind");
    expect(names.has("user-2")).toBe(false);
  });

  it("works when nobody has a profile", async () => {
    const { reader } = fakeReader({});

    const names = await getDisplayNames(["user-1", "user-2"], { reader });

    expect(names.size).toBe(0);
  });

  it.each([
    ["wrong type", { ...profile("x"), displayName: 7 }],
    ["non-canonical name", profile("  Anna ")],
    ["missing timestamps", { displayName: "Anna Berg" }],
    ["a non-object document", "Anna Berg"],
  ])("treats a corrupt profile (%s) as absent, exactly like the own-profile read", async (_label, doc) => {
    const { reader } = fakeReader({ "user-1": doc });

    const names = await getDisplayNames(["user-1"], { reader });

    expect(names.size).toBe(0);
  });

  it("never returns anything from a profile except its validated display name", async () => {
    const { reader } = fakeReader({ "user-1": { ...profile("Anna Berg"), email: "anna@example.com", extra: "secret" } });

    const names = await getDisplayNames(["user-1"], { reader });

    expect([...names.values()]).toEqual(["Anna Berg"]);
  });

  it("reads in batches of at most 100 document refs", async () => {
    expect(DISPLAY_NAME_BATCH_SIZE).toBe(100);
    const uids = Array.from({ length: 250 }, (_, i) => `user-${i}`);
    const { reader, batches } = fakeReader({});

    await getDisplayNames(uids, { reader });

    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 50]);
    expect(batches.flat()).toEqual(uids);
  });

  it("reads each uid once even if it is listed twice, and makes no call for an empty list", async () => {
    const { reader, batches } = fakeReader({});

    await getDisplayNames(["user-1", "user-1"], { reader });
    await getDisplayNames([], { reader });

    expect(batches).toEqual([["user-1"]]);
  });

  it.each([
    ["a slash", "a/b"],
    ["a dot", "."],
    ["two dots", ".."],
    ["a reserved __name__ id", "__x__"],
    ["an empty string", ""],
  ])("skips an id that is not a valid Firestore document id (%s) instead of failing the batch", async (_label, bad) => {
    const { reader, batches } = fakeReader({ "user-1": profile("Anna Berg") });

    const names = await getDisplayNames([bad, "user-1"], { reader });

    expect(names.get("user-1")).toBe("Anna Berg");
    expect(batches.flat()).toEqual(["user-1"]);
  });

  it("propagates a read failure so the caller can fail closed", async () => {
    const reader: ProfileBatchReader = { readBatch: vi.fn().mockRejectedValue(new Error("boom")) };

    await expect(getDisplayNames(["user-1"], { reader })).rejects.toThrow();
  });
});

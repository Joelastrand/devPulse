import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The raw batch read must touch only the requested documents, by id, through
 * `getAll`; it must never query the collection or use any write API. The
 * collection is identified only by "whatever the store uses" so this file does
 * not name it.
 */
const access = vi.hoisted(() => {
  const state = {
    docs: new Map<string, Record<string, unknown>>(),
    collections: new Set<string>(),
    docIds: [] as string[],
    getAllCalls: [] as string[][],
    forbidden: [] as string[],
    failGetAll: false,
  };
  const trap = (name: string) => () => {
    state.forbidden.push(name);
    throw new Error(`forbidden Firestore call: ${name}`);
  };
  const db = {
    collection(name: string) {
      state.collections.add(name);
      return {
        doc(id: string) {
          state.docIds.push(id);
          return { id, set: trap("set"), update: trap("update"), delete: trap("delete"), get: trap("doc.get") };
        },
        get: trap("collection.get"),
        where: trap("where"),
        orderBy: trap("orderBy"),
        limit: trap("limit"),
        select: trap("select"),
        listDocuments: trap("listDocuments"),
        add: trap("add"),
      };
    },
    async getAll(...refs: Array<{ id: string }>) {
      state.getAllCalls.push(refs.map((r) => r.id));
      if (state.failGetAll) throw new Error("unavailable");
      return refs.map((ref) => {
        const data = state.docs.get(ref.id);
        return { id: ref.id, exists: data !== undefined, data: () => data };
      });
    },
    runTransaction: trap("runTransaction"),
    batch: trap("batch"),
  };
  return { state, db };
});

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => access.db,
}));

import { readSkillProfilesBatch, SKILL_PROFILE_READ_CHUNK_SIZE } from "./skill-profile-store";

beforeEach(() => {
  access.state.docs.clear();
  access.state.collections.clear();
  access.state.docIds.length = 0;
  access.state.getAllCalls.length = 0;
  access.state.forbidden.length = 0;
  access.state.failGetAll = false;
});

describe("readSkillProfilesBatch (raw reader)", () => {
  it("reads exactly the requested documents by id and returns their raw data, undefined when absent", async () => {
    access.state.docs.set("uid-a", { levels: { t: 2 }, futureField: 1 });
    access.state.docs.set("uid-b", { levels: "garbage" });
    access.state.docs.set("uid-not-requested", { levels: { t: 4 } });

    const result = await readSkillProfilesBatch(["uid-a", "uid-b", "uid-missing"]);

    expect(result).toEqual([{ levels: { t: 2 }, futureField: 1 }, { levels: "garbage" }, undefined]);
    expect(access.state.getAllCalls).toEqual([["uid-a", "uid-b", "uid-missing"]]);
    expect(access.state.docIds).toEqual(["uid-a", "uid-b", "uid-missing"]);
    expect(access.state.collections.size).toBe(1);
  });

  it("issues no collection query and uses no write API", async () => {
    access.state.docs.set("uid-a", { levels: {} });
    await readSkillProfilesBatch(["uid-a"]);
    expect(access.state.forbidden).toEqual([]);
  });

  it("chunks the reads at the chunk size and loses no document", async () => {
    const uids = Array.from({ length: SKILL_PROFILE_READ_CHUNK_SIZE * 2 + 1 }, (_, i) => `uid-${i}`);
    for (const uid of uids) access.state.docs.set(uid, { levels: { t: 1 } });

    const result = await readSkillProfilesBatch(uids);

    expect(access.state.getAllCalls.map((c) => c.length)).toEqual([SKILL_PROFILE_READ_CHUNK_SIZE, SKILL_PROFILE_READ_CHUNK_SIZE, 1]);
    expect(access.state.getAllCalls.flat().sort()).toEqual([...uids].sort());
    expect(result).toHaveLength(uids.length);
  });

  it("makes no read for an empty input", async () => {
    expect(await readSkillProfilesBatch([])).toEqual([]);
    expect(access.state.getAllCalls).toEqual([]);
    expect(access.state.collections.size).toBe(0);
  });

  it("skips uids that are not valid document ids instead of failing or widening the read", async () => {
    access.state.docs.set("uid-a", { levels: { t: 3 } });
    const result = await readSkillProfilesBatch(["", "a/b", ".", "..", "__x__", "uid-a"]);
    expect(access.state.getAllCalls).toEqual([["uid-a"]]);
    expect(result).toEqual([{ levels: { t: 3 } }]);
  });

  it("propagates an infrastructure failure instead of returning an empty result", async () => {
    access.state.failGetAll = true;
    await expect(readSkillProfilesBatch(["uid-a"])).rejects.toThrow("unavailable");
  });

  it("leaves stored documents unchanged", async () => {
    const doc = { levels: [1], createdAt: "bad", futureField: { x: 1 } };
    access.state.docs.set("uid-a", doc);
    const before = structuredClone(doc);
    await readSkillProfilesBatch(["uid-a"]);
    expect(access.state.docs.get("uid-a")).toEqual(before);
  });
});

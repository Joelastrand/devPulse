import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearOwnSkillLevel } from "./clear-own-skill-level";
import { deleteOwnSkillProfile } from "./delete-own-skill-profile";
import { setOwnSkillLevel } from "./set-own-skill-level";

/**
 * BR-23/BR-24 forward independence: the real default store runs against a
 * recording Firestore fake that also holds seeded `skillProgress`,
 * `roadmapItems` and `teamMemberships` documents. A personal level mutation may
 * read/write only `skillProfiles` (and read `skillTrees` for PUT validation).
 */
const access = vi.hoisted(() => {
  const state = {
    docs: new Map<string, Record<string, unknown>>(),
    reads: [] as string[],
    writes: [] as string[],
    touched: [] as string[],
  };
  const doc = (collection: string, id: string) => ({ collection, id, key: `${collection}/${id}` });
  const db = {
    collection(name: string) {
      state.touched.push(name);
      return {
        doc: (id: string) => ({
          ...doc(name, id),
          async delete() {
            state.writes.push(name);
          },
        }),
      };
    },
    async runTransaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
      const tx = {
        async get(ref: { collection: string; key: string }) {
          state.reads.push(ref.collection);
          const data = state.docs.get(ref.key);
          return { exists: data !== undefined, data: () => data };
        },
        set(ref: { collection: string; key: string }) {
          state.writes.push(ref.collection);
        },
        update(ref: { collection: string; key: string }) {
          state.writes.push(ref.collection);
        },
      };
      return work(tx);
    },
  };
  return { state, db };
});

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => access.db,
}));

const UNRELATED = ["skillProgress", "roadmapItems", "teamMemberships"] as const;
const verifyToken = vi.fn().mockResolvedValue({ uid: "user-1", email: "user-1@example.com", email_verified: true });
const validTree = {
  name: "TypeScript",
  nodes: [
    { nodeId: "node-0", label: "Stage A", order: 0 },
    { nodeId: "node-1", label: "Stage B", order: 1 },
  ],
  createdAt: new Date("2026-01-01T00:00:00Z"),
  createdBy: "admin-uid",
};

function expectNoUnrelatedAccess() {
  for (const collection of UNRELATED) {
    expect(access.state.reads.filter((c) => c === collection)).toHaveLength(0);
    expect(access.state.writes.filter((c) => c === collection)).toHaveLength(0);
    expect(access.state.touched).not.toContain(collection);
  }
}

describe("skill-profile mutations are independent of team/product collections (BR-23/BR-24)", () => {
  beforeEach(() => {
    access.state.docs = new Map<string, Record<string, unknown>>([
      ["skillTrees/ts", validTree],
      ["skillProfiles/user-1", { levels: { go: 2 } }],
      ["skillProgress/user-1", { sentinel: true }],
      ["roadmapItems/item-1", { sentinel: true }],
      ["teamMemberships/user-1", { sentinel: true }],
    ]);
    access.state.reads = [];
    access.state.writes = [];
    access.state.touched = [];
  });

  it("PUT reads only skillProfiles and skillTrees, writes only skillProfiles, and never touches unrelated collections", async () => {
    const result = await setOwnSkillLevel("t", "ts", { level: 3 }, { verifyToken });

    expect(result).toEqual({ ok: true, level: 3 });
    expect([...new Set(access.state.reads)].sort()).toEqual(["skillProfiles", "skillTrees"]);
    expect(access.state.writes).toEqual(["skillProfiles"]);
    expectNoUnrelatedAccess();
  });

  it("DELETE-one reads and writes only skillProfiles and never touches unrelated collections", async () => {
    const result = await clearOwnSkillLevel("t", "go", { verifyToken });

    expect(result).toEqual({ ok: true, level: null });
    expect(access.state.reads).toEqual(["skillProfiles"]);
    expect(access.state.writes).toEqual(["skillProfiles"]);
    expectNoUnrelatedAccess();
  });

  it("DELETE-all writes only skillProfiles, reads nothing, and never touches unrelated collections", async () => {
    const result = await deleteOwnSkillProfile("t", { verifyToken });

    expect(result).toEqual({ ok: true });
    expect(access.state.reads).toEqual([]);
    expect(access.state.writes).toEqual(["skillProfiles"]);
    expect(access.state.touched).toEqual(["skillProfiles"]);
    expectNoUnrelatedAccess();
  });

  it("failed and rejected mutations also leave unrelated collections untouched", async () => {
    await setOwnSkillLevel("t", "missing-tree", { level: 2 }, { verifyToken });
    await setOwnSkillLevel("t", "ts", { level: 9 }, { verifyToken });
    await clearOwnSkillLevel("t", "absent", { verifyToken });

    expectNoUnrelatedAccess();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearOwnSkillLevel } from "./clear-own-skill-level";
import { deleteOwnSkillProfile } from "./delete-own-skill-profile";
import { setOwnSkillLevel } from "./set-own-skill-level";

/**
 * BR-23/BR-24 forward independence: the real default store runs against a
 * recording Firestore fake that also holds seeded `skillProgress`,
 * `roadmapItems` and `teamMemberships` documents. A personal level mutation may
 * read/write only `skillProfiles` (and read `skillTrees` for PUT validation).
 * The one additional read is the erasure fence, `accountErasures/{uid}`, which every
 * skill-profile write reads first in its own transaction (TASK-025, BR-4(b)).
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
        delete(ref: { collection: string; key: string }) {
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
    expect([...new Set(access.state.reads)].sort()).toEqual(["accountErasures", "skillProfiles", "skillTrees"]);
    expect(access.state.writes).toEqual(["skillProfiles"]);
    expectNoUnrelatedAccess();
  });

  it("DELETE-one reads the fence then the profile, writes only skillProfiles, and never touches unrelated collections", async () => {
    const result = await clearOwnSkillLevel("t", "go", { verifyToken });

    expect(result).toEqual({ ok: true, level: null });
    expect(access.state.reads).toEqual(["accountErasures", "skillProfiles"]);
    expect(access.state.writes).toEqual(["skillProfiles"]);
    expectNoUnrelatedAccess();
  });

  it("DELETE-all reads only the fence, writes only skillProfiles, and never touches unrelated collections", async () => {
    const result = await deleteOwnSkillProfile("t", { verifyToken });

    expect(result).toEqual({ ok: true });
    expect(access.state.reads).toEqual(["accountErasures"]);
    expect(access.state.writes).toEqual(["skillProfiles"]);
    expect([...access.state.touched].sort()).toEqual(["accountErasures", "skillProfiles"]);
    expectNoUnrelatedAccess();
  });

  describe("erasure fence on every skill-profile write (TASK-025, BR-4(b))", () => {
    it.each([
      ["a valid in-progress record", { status: "in_progress" }],
      ["a malformed record", "not-a-record"],
    ])("PUT with %s refuses as erasure_in_progress, reads nothing else, and writes nothing", async (_label, record) => {
      access.state.docs.set("accountErasures/user-1", record as Record<string, unknown>);

      const result = await setOwnSkillLevel("t", "ts", { level: 3 }, { verifyToken });

      expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
      expect(access.state.reads).toEqual(["accountErasures"]);
      expect(access.state.writes).toEqual([]);
      expectNoUnrelatedAccess();
    });

    it("DELETE-one with an erasure record refuses as erasure_in_progress and leaves the level in place", async () => {
      access.state.docs.set("accountErasures/user-1", { status: "in_progress" });

      const result = await clearOwnSkillLevel("t", "go", { verifyToken });

      expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
      expect(access.state.writes).toEqual([]);
      expect(access.state.docs.get("skillProfiles/user-1")).toEqual({ levels: { go: 2 } });
    });

    it.each([
      ["a valid in-progress record", { status: "in_progress" }],
      ["a malformed record", "not-a-record"],
    ])("DELETE-all with %s refuses as erasure_in_progress and deletes nothing", async (_label, record) => {
      access.state.docs.set("accountErasures/user-1", record as Record<string, unknown>);

      const result = await deleteOwnSkillProfile("t", { verifyToken });

      expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
      expect(access.state.reads).toEqual(["accountErasures"]);
      expect(access.state.writes).toEqual([]);
    });
  });

  it("failed and rejected mutations also leave unrelated collections untouched", async () => {
    await setOwnSkillLevel("t", "missing-tree", { level: 2 }, { verifyToken });
    await setOwnSkillLevel("t", "ts", { level: 9 }, { verifyToken });
    await clearOwnSkillLevel("t", "absent", { verifyToken });

    expectNoUnrelatedAccess();
  });
});

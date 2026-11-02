import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoadmapItem } from "./create-roadmap-item";
import { updateRoadmapItem } from "./update-roadmap-item";

// TASK-032: the roadmap lead writes read the writer's erasure fence first, in the same transaction, and write nothing when
// the fence refuses. Structural test over a recording Admin Firestore double (not Firestore's conflict behaviour, which is
// the D-EMU gate). Fixtures are synthetic; the uid is a fictional lead.

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => holder.db,
}));
vi.mock("server-only", () => ({}));

const LEAD_UID = "lead-32";
const TEAM_ID = "team-32";
const TREE_ID = "tree-32";
const ROADMAP_PATH = `roadmapItems/${TEAM_ID}__${TREE_ID}`;

type Data = Record<string, unknown>;

const docs = new Map<string, Data>();
const writes: string[] = [];

holder.db = {
  collection: (name: string) => ({
    doc: (id: string) => {
      const path = `${name}/${id}`;
      return { path, get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }) };
    },
  }),
  async runTransaction(work: (tx: unknown) => Promise<unknown>) {
    const tx = {
      async get(ref: { path: string }) {
        return { exists: docs.has(ref.path), data: () => docs.get(ref.path) };
      },
      create(ref: { path: string }) {
        writes.push(`create|${ref.path}`);
      },
      set(ref: { path: string }) {
        writes.push(`set|${ref.path}`);
      },
      update(ref: { path: string }) {
        writes.push(`update|${ref.path}`);
      },
    };
    return work(tx);
  },
};

const verifyToken = vi.fn().mockResolvedValue({ uid: LEAD_UID, email: "lead@example.com", email_verified: true });

beforeEach(() => {
  docs.clear();
  writes.length = 0;
  docs.set(`accountErasures/${LEAD_UID}`, { status: "in_progress", step: "forum" });
});

describe("roadmap lead writes are refused while the lead's erasure record exists", () => {
  it("create refuses with erasure_in_progress and writes no roadmap item", async () => {
    const result = await createRoadmapItem("t", TEAM_ID, { treeId: TREE_ID, targetNodeId: "node-2" }, { verifyToken });

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(writes).toEqual([]);
  });

  it("update refuses with erasure_in_progress and leaves the roadmap item untouched", async () => {
    docs.set(ROADMAP_PATH, { teamId: TEAM_ID, treeId: TREE_ID, priority: "high" });

    const result = await updateRoadmapItem("t", TEAM_ID, TREE_ID, { priority: "low" }, { verifyToken });

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(writes).toEqual([]);
  });
});

describe("an owner assignment refused by the erasure fence writes nothing, including the membership touch (TASK-038, A-5)", () => {
  it("update with a new ownerRef is refused and performs neither the roadmap write nor the membership touch", async () => {
    docs.set(`roadmapItems/${TEAM_ID}__${TREE_ID}`, { teamId: TEAM_ID, treeId: TREE_ID, priority: "high" });

    const result = await updateRoadmapItem("t", TEAM_ID, TREE_ID, { ownerRef: "ref-35" }, { verifyToken });

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(writes).toEqual([]);
  });
});

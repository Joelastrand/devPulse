import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateSkillTree } from "./update-skill-tree";

// TASK-035: the skill-tree update (stamps `updatedBy`) reads the acting admin's erasure fence in the same transaction as the
// write. Refusal writes nothing. Structural test over a recording Admin Firestore double; fixtures are synthetic.

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => holder.db,
}));
vi.mock("server-only", () => ({}));

const ADMIN_UID = "admin-35b";
const isAdminUid = async (uid: string): Promise<boolean> => uid === ADMIN_UID;
const ADMIN_EMAIL = "admin35b@example.com";
const TREE_ID = "tree-35b";
const TREE_PATH = `skillTrees/${TREE_ID}`;
const ADMIN_FENCE = `accountErasures/${ADMIN_UID}`;

type Data = Record<string, unknown>;
const docs = new Map<string, Data>();
const writes: string[] = [];

function pathOf(ref: { path: string }): string {
  return ref.path;
}

holder.db = {
  collection: (name: string) => ({
    doc: (id: string) => {
      const path = `${name}/${id}`;
      return { id, path, get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }) };
    },
  }),
  async runTransaction(work: (tx: unknown) => Promise<unknown>) {
    const tx = {
      async get(ref: { path: string }) {
        return { exists: docs.has(pathOf(ref)), data: () => docs.get(pathOf(ref)) };
      },
      update(ref: { path: string }, data: Data) {
        writes.push(`update|${pathOf(ref)}`);
        docs.set(pathOf(ref), { ...docs.get(pathOf(ref)), ...data });
      },
    };
    return work(tx);
  },
};

const verifyToken = vi.fn().mockResolvedValue({ uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true });
const isSuperadmin = isAdminUid;

function seedTree(): void {
  docs.set(TREE_PATH, {
    name: "Container adoption",
    nodes: [
      { nodeId: "node-0", label: "Start", order: 0 },
      { nodeId: "node-1", label: "Next", order: 1 },
    ],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: "admin-0",
  });
}

beforeEach(() => {
  docs.clear();
  writes.length = 0;
});

describe("skill-tree update is refused while the acting admin's erasure record exists", () => {
  it("refuses with erasure_in_progress and leaves the tree unchanged", async () => {
    seedTree();
    docs.set(ADMIN_FENCE, { status: "in_progress", step: "forum" });
    const before = docs.get(TREE_PATH);

    const result = await updateSkillTree("t", TREE_ID, "Renamed", ["Start", "Next"], { verifyToken, isSuperadmin: isAdminUid });

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(writes).toEqual([]);
    expect(docs.get(TREE_PATH)).toBe(before);
  });

  it("without an erasure record, the update writes and stamps updatedBy (unchanged behaviour)", async () => {
    seedTree();

    const result = await updateSkillTree("t", TREE_ID, "Renamed", ["Start", "Next"], { verifyToken, isSuperadmin: isAdminUid });

    expect(result).toEqual({ ok: true });
    expect(writes).toEqual([`update|${TREE_PATH}`]);
    expect(docs.get(TREE_PATH)).toMatchObject({ name: "Renamed", updatedBy: ADMIN_UID });
  });
});

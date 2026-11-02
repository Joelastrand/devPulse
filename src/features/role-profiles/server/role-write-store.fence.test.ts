import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredRoleDefinition } from "../domain/role-definition";
import { getDefaultRoleWriteStore } from "./role-store";

// TASK-035: the role-definition writer store (create, update) reads the acting admin's erasure fence first, in the same
// transaction, and writes nothing when it refuses. Structural test over a recording Admin Firestore double. Fixtures are
// synthetic; the admin uid is fictional.

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => holder.db,
}));
vi.mock("server-only", () => ({}));

const ADMIN_UID = "admin-35";
const ROLE_ID = "role-35";

const docs = new Map<string, Record<string, unknown>>();
const writes: string[] = [];

holder.db = {
  collection: (name: string) => ({
    doc: (id?: string) => {
      const docId = id ?? "generated-35";
      return { id: docId, path: `${name}/${docId}` };
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
      update(ref: { path: string }) {
        writes.push(`update|${ref.path}`);
      },
    };
    return work(tx);
  },
};

const role = {
  name: "Synthetic role",
  expectations: [],
  createdAt: new Date("2026-10-01T00:00:00Z"),
  createdBy: ADMIN_UID,
} as unknown as StoredRoleDefinition;

beforeEach(() => {
  docs.clear();
  writes.length = 0;
});

describe("role-definition writer store is refused while the admin's erasure record exists", () => {
  it("create throws ErasureWriteRefused and creates no role", async () => {
    docs.set(`accountErasures/${ADMIN_UID}`, { status: "in_progress", step: "forum" });
    const store = getDefaultRoleWriteStore(ADMIN_UID, { generateId: () => ROLE_ID });

    await expect(store.create(role)).rejects.toMatchObject({ code: "erasure_in_progress" });
    expect(writes).toEqual([]);
  });

  it("update throws ErasureWriteRefused and writes nothing", async () => {
    docs.set(`accountErasures/${ADMIN_UID}`, { status: "in_progress", step: "forum" });
    const store = getDefaultRoleWriteStore(ADMIN_UID);

    await expect(store.update(ROLE_ID, { set: { name: "Renamed" }, unset: [] })).rejects.toMatchObject({
      code: "erasure_in_progress",
    });
    expect(writes).toEqual([]);
  });

  it("create without an erasure record writes the role (unchanged behaviour)", async () => {
    const store = getDefaultRoleWriteStore(ADMIN_UID, { generateId: () => ROLE_ID });

    await expect(store.create(role)).resolves.toBe(ROLE_ID);
    expect(writes).toEqual([`create|roleDefinitions/${ROLE_ID}`]);
  });
});

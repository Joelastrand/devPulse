import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultRoleTargetStore } from "./role-target-store";

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => holder.db,
}));

type Data = Record<string, unknown>;
const NOW = new Date("2026-10-03T12:00:00Z");
const TARGET_PATH = "userDevelopment/uid-owner/roleTarget/current";

/**
 * Recording double of the Admin Firestore surface the store uses. `docs` maps a document path to its data; absent paths
 * read as missing. It records the exact call chain and every transactional write, and never contacts Firebase.
 */
function createRecordingDb(docs: Record<string, Data> = {}) {
  const log: string[] = [];
  const sets: Array<{ path: string; data: Data }> = [];
  const snapshotOf = (path: string) => ({
    id: path.split("/").at(-1),
    exists: path in docs,
    data: () => docs[path],
  });
  const docRef = (path: string) => ({
    path,
    get: async () => {
      log.push(`${path}|get`);
      return snapshotOf(path);
    },
    delete: async () => {
      log.push(`${path}|delete`);
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  });
  const collectionRef = (path: string) => ({
    doc: (id: string) => docRef(`${path}/${id}`),
  });
  const db = {
    collection: (name: string) => collectionRef(name),
    runTransaction: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
      log.push("runTransaction");
      return work({
        get: async (ref: { path: string }) => {
          log.push(`tx.get|${ref.path}`);
          return snapshotOf(ref.path);
        },
        set: (ref: { path: string }, data: Data) => {
          log.push(`tx.set|${ref.path}`);
          sets.push({ path: ref.path, data });
        },
      });
    },
  };
  return { log, sets, db };
}

describe("Admin role target store", () => {
  beforeEach(() => {
    holder.db = undefined;
  });

  it("reads and deletes only the owner's fixed current document", async () => {
    const recorder = createRecordingDb({ [TARGET_PATH]: { roleId: "role-1" } });
    holder.db = recorder.db;
    const store = getDefaultRoleTargetStore();

    await store.get("uid-owner");
    await store.delete("uid-owner");

    expect(recorder.log).toEqual([`${TARGET_PATH}|get`, `${TARGET_PATH}|delete`]);
  });

  it("returns undefined for an absent document", async () => {
    holder.db = createRecordingDb().db;

    await expect(getDefaultRoleTargetStore().get("uid-owner")).resolves.toBeUndefined();
  });

  it("refuses a subject uid that could escape the owner's document path, before any Firestore call", async () => {
    const recorder = createRecordingDb();
    holder.db = recorder.db;
    const store = getDefaultRoleTargetStore();

    await expect(store.get("a/b")).rejects.toThrow("invalid role target key");
    await expect(store.delete("..")).rejects.toThrow("invalid role target key");
    await expect(store.runSelection("", async () => undefined)).rejects.toThrow("invalid role target key");
    expect(recorder.log).toEqual([]);
  });

  it("selection reads the role and SkillTrees through the transaction, then writes the target once", async () => {
    const recorder = createRecordingDb({
      "roleDefinitions/role-1": { name: "Backend", expectations: [], createdAt: NOW, createdBy: "admin-uid" },
      "skillTrees/api": { name: "API design", nodes: [], createdAt: NOW, createdBy: "admin-uid" },
    });
    holder.db = recorder.db;

    await getDefaultRoleTargetStore().runSelection("uid-owner", async (scope) => {
      await scope.readRole("role-1");
      await scope.trees.getMany(["api"]);
      scope.writeTarget({ roleId: "role-1", updatedAt: NOW });
      return undefined;
    });

    expect(recorder.log).toEqual([
      "runTransaction",
      "tx.get|roleDefinitions/role-1",
      "tx.get|skillTrees/api",
      `tx.set|${TARGET_PATH}`,
    ]);
    expect(recorder.sets).toEqual([{ path: TARGET_PATH, data: { roleId: "role-1", updatedAt: Timestamp.fromDate(NOW) } }]);
  });

  it("rejects a read attempted after the selection write (PG-7 ordering)", async () => {
    const recorder = createRecordingDb({
      "roleDefinitions/role-1": { name: "Backend", expectations: [], createdAt: NOW, createdBy: "admin-uid" },
    });
    holder.db = recorder.db;

    await expect(
      getDefaultRoleTargetStore().runSelection("uid-owner", async (scope) => {
        scope.writeTarget({ roleId: "role-1", updatedAt: NOW });
        return scope.readRole("role-1");
      }),
    ).rejects.toThrow("role read after the selection write");
    expect(recorder.log.filter((entry) => entry.startsWith("tx.get|"))).toEqual([]);
  });
});

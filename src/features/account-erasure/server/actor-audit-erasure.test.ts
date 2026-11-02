import { describe, expect, it } from "vitest";
import { ErasureStepFailure } from "./erasure-runner";
import {
  runActorAuditBatch,
  type ActorAuditErasurePort,
  type ActorAuditTarget,
  type ActorAuditTransaction,
} from "./actor-audit-erasure";

// TASK-023: actor fields on surveys, skill trees, role definitions and challenges. Fixtures are synthetic.
// These are port-contract tests over an in-memory store. Clearing is checked per field, so a test cannot pass by
// clearing a different field.

const UID = "erased-uid";
const OTHER = "other-uid";

type Docs = Record<string, Record<string, Record<string, unknown>>>; // collection -> documentId -> fields

function fakeActorStore(docs: Docs) {
  const store: Docs = structuredClone(docs);
  const log: string[] = [];

  const tx: ActorAuditTransaction = {
    async getDocument(target, documentId) {
      const doc = store[target.collection]?.[documentId];
      return doc === undefined ? undefined : { ...doc };
    },
    clearActorField(target, documentId) {
      log.push(`${target.collection}/${documentId}.${target.field}`);
      const doc = store[target.collection]?.[documentId];
      if (doc) doc[target.field] = null;
    },
  };

  const port: ActorAuditErasurePort = {
    async runTransaction(work) {
      return work(tx);
    },
    async findActorReference(uid, target: ActorAuditTarget) {
      return Object.entries(store[target.collection] ?? {}).find(([, doc]) => doc[target.field] === uid)?.[0];
    },
  };

  return { port, store, log };
}

async function runToDone(port: ActorAuditErasurePort, uid: string): Promise<void> {
  for (let batch = 0; batch < 50; batch += 1) {
    if ((await runActorAuditBatch({ port }, uid, 100)) === "done") return;
  }
  throw new Error("actor audit step did not reach done");
}

describe("actor audit erasure step (TASK-023)", () => {
  it("clears each of the eight actor fields that holds the erased uid, and nothing else changes", async () => {
    const docs: Docs = {
      surveys: { s1: { teamId: "t1", title: "Survey", createdBy: UID } },
      skillTrees: { tree1: { name: "Tree", createdBy: UID, updatedBy: UID, updatedAt: new Date("2026-06-02") } },
      roleDefinitions: {
        role1: { name: "Role", createdBy: UID, updatedBy: UID, archivedBy: UID, archivedAt: new Date("2026-06-03") },
      },
      challenges: { c1: { ciphertext: "keep-me", resolvedBy: UID, archivedBy: UID, resolvedAt: new Date("2026-06-04") } },
    };
    const store = fakeActorStore(docs);

    await runToDone(store.port, UID);

    expect(store.store.surveys.s1).toEqual({ teamId: "t1", title: "Survey", createdBy: null });
    expect(store.store.skillTrees.tree1).toMatchObject({ name: "Tree", createdBy: null, updatedBy: null });
    expect(store.store.roleDefinitions.role1).toMatchObject({ name: "Role", createdBy: null, updatedBy: null, archivedBy: null });
    expect(store.store.challenges.c1).toMatchObject({ ciphertext: "keep-me", resolvedBy: null, archivedBy: null });
    // Eight fields hold the uid in this fixture (1 survey, 2 skill tree, 3 role definition, 2 challenge), so eight clears.
    expect(store.log).toHaveLength(8);
  });

  it("leaves another person's catalogue, survey and challenge fields untouched", async () => {
    const store = fakeActorStore({
      surveys: { s1: { createdBy: OTHER } },
      challenges: { c1: { resolvedBy: OTHER, archivedBy: null } },
    });

    await runToDone(store.port, UID);

    expect(store.store.surveys.s1.createdBy).toBe(OTHER);
    expect(store.store.challenges.c1.resolvedBy).toBe(OTHER);
    expect(store.log).toEqual([]);
  });

  it("does not clear a field that already holds null (no reference, no write)", async () => {
    const store = fakeActorStore({ surveys: { s1: { createdBy: null } } });

    expect(await runActorAuditBatch({ port: store.port }, UID, 100)).toBe("done");
    expect(store.log).toEqual([]);
  });

  it("fails closed, with no write, when a listed document's field no longer names the uid", async () => {
    const store = fakeActorStore({ surveys: { s1: { createdBy: OTHER } } });
    const faulty: ActorAuditErasurePort = {
      ...store.port,
      findActorReference: async (_uid, target) => (target.collection === "surveys" ? "s1" : undefined),
    };

    await expect(runActorAuditBatch({ port: faulty }, UID, 100)).rejects.toMatchObject({ code: "verification_failed" });
    expect(store.log).toEqual([]);
  });

  it("fails closed on a listed document that no longer reads back", async () => {
    const store = fakeActorStore({});
    const faulty: ActorAuditErasurePort = {
      ...store.port,
      findActorReference: async (_uid, target) => (target.collection === "surveys" ? "ghost" : undefined),
    };

    await expect(runActorAuditBatch({ port: faulty }, UID, 100)).rejects.toMatchObject({ code: "verification_failed" });
  });

  it("refuses a zero write budget as a programming error", async () => {
    const store = fakeActorStore({});
    await expect(runActorAuditBatch({ port: store.port }, UID, 0)).rejects.toBeInstanceOf(ErasureStepFailure);
  });
});

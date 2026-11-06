import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runActorAuditBatch, type ActorAuditErasurePort, type ActorAuditTransaction, type ActorAuditTarget } from "./actor-audit-erasure";
import { ErasureStepFailure } from "./erasure-runner";
import { ACTOR_AUDIT_TARGETS } from "./inventory";

// TASK-039 (team-system-overview, OQ-1 approved 2026-11-05): A-13, `teamSystems` actor fields. `createdBy` and `updatedBy`
// are top-level; `assessedBy` lives inside each assessment map (`availability`, `maintainability`, `security`). Each is nulled
// on its own. The record, the values, the notes and the historical `assessedAt` timestamps are kept. Synthetic fixtures only.

const UID = "erased-uid";
const OTHER_UID = "other-uid";

type Doc = Record<string, unknown>;

function target(field: string): ActorAuditTarget {
  const found = ACTOR_AUDIT_TARGETS.find((t) => t.collection === "teamSystems" && t.field === field);
  if (found === undefined) throw new Error(`no teamSystems target for ${field}`);
  return found;
}

function readField(doc: Doc, field: string): unknown {
  const [parent, child] = field.split(".");
  if (child === undefined) return doc[field];
  const nested = doc[parent];
  return typeof nested === "object" && nested !== null ? (nested as Doc)[child] : undefined;
}

function clearField(doc: Doc, field: string): Doc {
  const copy = structuredClone(doc);
  const [parent, child] = field.split(".");
  if (child === undefined) {
    copy[field] = null;
    return copy;
  }
  (copy[parent] as Doc)[child] = null;
  return copy;
}

function fakeStore(docs: Record<string, Doc>) {
  const store = new Map<string, Doc>(Object.entries(docs).map(([id, data]) => [id, structuredClone(data)]));
  const port: ActorAuditErasurePort = {
    async runTransaction<T>(work: (tx: ActorAuditTransaction) => Promise<T>): Promise<T> {
      const tx: ActorAuditTransaction = {
        async getDocument(_target, documentId) {
          const data = store.get(documentId);
          return data === undefined ? undefined : structuredClone(data);
        },
        clearActorField(t, documentId) {
          const data = store.get(documentId);
          if (data !== undefined) store.set(documentId, clearField(data, t.field));
        },
      };
      return work(tx);
    },
    async findActorReference(uid, t) {
      for (const [id, data] of store) {
        if (t.collection === "teamSystems" && readField(data, t.field) === uid) return id;
      }
      return undefined;
    },
  };
  return { store, port };
}

async function runToDone(port: ActorAuditErasurePort, maxWrites = 100): Promise<void> {
  for (let batch = 0; batch < 100; batch += 1) {
    if ((await runActorAuditBatch({ port }, UID, maxWrites)) === "done") return;
  }
  throw new Error("actor audit did not reach done");
}

const assessment = (value: string, assessedBy: string | null, assessedAt: Date | null) => ({
  value,
  note: "Synthetic note",
  assessedAt,
  assessedBy,
});

function systemDoc(overrides: Partial<Record<"createdBy" | "updatedBy", string | null>> & { assessedByAll?: string | null } = {}): Doc {
  const assessedBy = overrides.assessedByAll === undefined ? UID : overrides.assessedByAll;
  const at = new Date("2026-10-01T10:00:00Z");
  return {
    teamId: "team-1",
    name: "Billing",
    description: "Synthetic description",
    backstageUrl: null,
    availability: assessment("god", assessedBy, at),
    maintainability: assessment("ok", assessedBy, at),
    security: assessment("ikke_vurdert", null, null),
    knowledgeMemberRefs: ["ref-kept-0000000000000001"],
    createdAt: at,
    createdBy: overrides.createdBy === undefined ? UID : overrides.createdBy,
    updatedAt: at,
    updatedBy: overrides.updatedBy === undefined ? UID : overrides.updatedBy,
  };
}

describe("actor audit for teamSystems (TASK-039, A-13)", () => {
  it("registers createdBy, updatedBy and the three assessedBy leaves as closed targets", () => {
    for (const field of ["createdBy", "updatedBy", "availability.assessedBy", "maintainability.assessedBy", "security.assessedBy"]) {
      expect(() => target(field)).not.toThrow();
    }
  });

  it("nulls createdBy and updatedBy, and keeps the record, its name, its assessments and its ref list", async () => {
    const { store, port } = fakeStore({ "sys-1": systemDoc({ createdBy: UID, updatedBy: UID, assessedByAll: null }) });

    await runToDone(port);

    const after = store.get("sys-1") as Doc;
    expect(after.createdBy).toBeNull();
    expect(after.updatedBy).toBeNull();
    expect(after.name).toBe("Billing");
    expect(after.description).toBe("Synthetic description");
    expect(after.knowledgeMemberRefs).toEqual(["ref-kept-0000000000000001"]);
    expect(after.availability).toEqual(assessment("god", null, new Date("2026-10-01T10:00:00Z")));
  });

  it("nulls only the assessedBy leaf of each map, keeping its value, note and historical assessedAt", async () => {
    const { store, port } = fakeStore({ "sys-1": systemDoc() });

    await runToDone(port);

    const after = store.get("sys-1") as Doc;
    const at = new Date("2026-10-01T10:00:00Z");
    expect(after.availability).toEqual(assessment("god", null, at));
    expect(after.maintainability).toEqual(assessment("ok", null, at));
    expect(after.security).toEqual(assessment("ikke_vurdert", null, null));
  });

  it("never writes another real user's id in place of the erased one (null only)", async () => {
    const { store, port } = fakeStore({ "sys-1": systemDoc({ createdBy: UID, updatedBy: OTHER_UID }) });

    await runToDone(port);

    const after = store.get("sys-1") as Doc;
    expect(after.createdBy).toBeNull();
    expect(after.updatedBy).toBe(OTHER_UID);
  });

  it("leaves an assessedBy of another member untouched", async () => {
    const at = new Date("2026-10-02T10:00:00Z");
    const { store, port } = fakeStore({
      "sys-1": { ...systemDoc({ assessedByAll: OTHER_UID, createdBy: OTHER_UID, updatedBy: OTHER_UID }), availability: assessment("god", OTHER_UID, at) },
    });

    await runToDone(port);

    expect((store.get("sys-1") as Doc).availability).toEqual(assessment("god", OTHER_UID, at));
  });

  it("is idempotent: a second erasure run after completion changes nothing and reports done", async () => {
    const { store, port } = fakeStore({ "sys-1": systemDoc() });
    await runToDone(port);
    const afterFirst = structuredClone(store.get("sys-1"));

    await runToDone(port);

    expect(store.get("sys-1")).toEqual(afterFirst);
  });

  it("fails closed when a listed document no longer names the uid at the stored path: nothing is changed", async () => {
    const { store, port } = fakeStore({ "sys-1": systemDoc({ createdBy: UID }) });
    const stale: ActorAuditErasurePort = {
      ...port,
      async runTransaction(work) {
        return port.runTransaction(async (tx) =>
          work({
            ...tx,
            async getDocument(t, id) {
              const doc = await tx.getDocument(t, id);
              return doc === undefined ? undefined : { ...doc, createdBy: OTHER_UID };
            },
          }),
        );
      },
    };

    await expect(runActorAuditBatch({ port: stale }, UID, 100)).rejects.toBeInstanceOf(ErasureStepFailure);
    expect((store.get("sys-1") as Doc).createdBy).toBe(UID);
  });

  it("handles a multi-system team: each system is cleared, one document per batch", async () => {
    const { store, port } = fakeStore({
      "sys-1": systemDoc(),
      "sys-2": systemDoc({ createdBy: UID, updatedBy: UID, assessedByAll: UID }),
    });

    let batches = 0;
    for (;;) {
      batches += 1;
      if ((await runActorAuditBatch({ port }, UID, 100)) === "done") break;
    }

    expect(batches).toBeGreaterThan(2);
    for (const id of ["sys-1", "sys-2"]) {
      const after = store.get(id) as Doc;
      expect(after.createdBy).toBeNull();
      expect(after.updatedBy).toBeNull();
      expect(readField(after, "availability.assessedBy")).toBeNull();
    }
  });
});

// Team-system overview round 2: the four newer attributes carry their own assessedBy leaf (A-13 applies to all seven maps).
describe("actor audit for teamSystems newer attributes (round 2, A-13)", () => {
  const NEWER = ["reliability", "testability", "deployability", "observability"] as const;

  it("registers an assessedBy closed target for each newer attribute", () => {
    for (const attribute of NEWER) {
      expect(() => target(`${attribute}.assessedBy`)).not.toThrow();
    }
  });

  it("nulls the assessedBy leaf of each newer map, keeping value, note and assessedAt", async () => {
    const at = new Date("2026-10-02T09:00:00Z");
    const doc = systemDoc();
    for (const attribute of NEWER) {
      doc[attribute] = assessment("trenger_oppfolging", UID, at);
    }
    const { store, port } = fakeStore({ "sys-2": doc });

    await runToDone(port);

    const after = store.get("sys-2") as Doc;
    for (const attribute of NEWER) {
      expect(after[attribute]).toEqual(assessment("trenger_oppfolging", null, at));
    }
  });
});

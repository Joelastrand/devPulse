import { describe, expect, it } from "vitest";
import { runActorAuditBatch, type ActorAuditErasurePort, type ActorAuditTransaction } from "./actor-audit-erasure";
import { ACTOR_AUDIT_TARGETS } from "./inventory";
import { parseRoadmapItem } from "../../roadmap/domain/roadmap-item";
import { isValidSkillProgress } from "../../skill-trees/domain/skill-progress";

// TASK-024: actor fields on roadmap items, skill progress, team memberships and teams (SPEC A-4, A-6, A-11, A-12).
// Fixtures are synthetic. Port-contract tests over an in-memory store, as in the TASK-023 suite.

const UID = "erased-uid";
const OTHER = "other-uid";
const NEW_TARGETS = [
  { collection: "roadmapItems", field: "createdBy" },
  { collection: "roadmapItems", field: "updatedBy" },
  { collection: "roadmapItems", field: "archivedBy" },
  { collection: "skillProgress", field: "updatedBy" },
  { collection: "teamMemberships", field: "grantedBy" },
  { collection: "teamMemberships", field: "roleUpdatedBy" },
  { collection: "teams", field: "createdBy" },
] as const;

type Docs = Record<string, Record<string, Record<string, unknown>>>;

function fakeStore(docs: Docs) {
  const store: Docs = structuredClone(docs);
  const tx: ActorAuditTransaction = {
    async getDocument(target, documentId) {
      const doc = store[target.collection]?.[documentId];
      return doc === undefined ? undefined : { ...doc };
    },
    clearActorField(target, documentId) {
      const doc = store[target.collection]?.[documentId];
      if (doc) doc[target.field] = null;
    },
  };
  const port: ActorAuditErasurePort = {
    async runTransaction(work) {
      return work(tx);
    },
    async findActorReference(uid, target) {
      return Object.entries(store[target.collection] ?? {}).find(([, doc]) => doc[target.field] === uid)?.[0];
    },
  };
  return { store, port };
}

/** Runs the actor-audit step to completion, one batch at a time, as the runner does. */
async function runToDone(port: ActorAuditErasurePort): Promise<void> {
  for (let batches = 0; batches < 100; batches += 1) {
    if ((await runActorAuditBatch({ port }, UID, 10)) === "done") return;
  }
  throw new Error("actor audit did not finish");
}

describe("actor audit for TASK-024 fields (A-4, A-6, A-11, A-12)", () => {
  it("registers exactly the TASK-024 fields in the closed actor-audit target list", () => {
    const registered = ACTOR_AUDIT_TARGETS.filter((target) => NEW_TARGETS.some((expected) => expected.collection === target.collection && expected.field === target.field));
    expect(registered).toHaveLength(NEW_TARGETS.length);
    // 15 before TASK-039; TASK-039 (A-13) adds createdBy, updatedBy and three assessedBy targets.
    // Team-system overview round 2 adds one assessedBy target for each of the four newer attributes (seven total).
    // Owner decision (account erasure Option A) adds superadmin grantedByUid and revokedByUid (A-16): 26 in total.
    // Team-owned skills (SPEC §7) adds createdBy and updatedBy of teamSkills (A-17): 28 in total.
    // Formal role assignment (role-profiles SPEC, A-18) adds createdBy and updatedBy of roleAssignments: 30 in total.
    // Collaborative team level (team-owned skills SPEC §12, A-19) adds updatedBy of teamManualAssessments: 31 in total.
    expect(ACTOR_AUDIT_TARGETS).toHaveLength(31);
  });

  it.each(NEW_TARGETS)("clears $collection.$field to null, keeps the record and its other fields", async ({ collection, field }) => {
    const { store, port } = fakeStore({
      [collection]: { doc1: { [field]: UID, teamId: "team-alpha", note: "Synthetic kept value" } },
    });

    await runToDone(port);

    expect(store[collection]?.doc1).toEqual({ [field]: null, teamId: "team-alpha", note: "Synthetic kept value" });
  });

  it("leaves other members' memberships unchanged when only the erased uid's grant or role is cleared", async () => {
    const { store, port } = fakeStore({
      teamMemberships: {
        "other__team-alpha": { uid: OTHER, teamId: "team-alpha", grantedBy: UID, roleUpdatedBy: UID, createdVia: "invitation" },
        "bystander__team-alpha": { uid: "bystander-uid", teamId: "team-alpha", grantedBy: OTHER, createdVia: "admin_direct" },
      },
    });

    await runToDone(port);

    expect(store.teamMemberships?.["other__team-alpha"]).toEqual({
      uid: OTHER,
      teamId: "team-alpha",
      grantedBy: null,
      roleUpdatedBy: null,
      createdVia: "invitation",
    });
    expect(store.teamMemberships?.["bystander__team-alpha"]).toEqual({
      uid: "bystander-uid",
      teamId: "team-alpha",
      grantedBy: OTHER,
      createdVia: "admin_direct",
    });
  });

  it("finishes with nothing left when no TASK-024 field holds the erased uid", async () => {
    const { store, port } = fakeStore({ teams: { t1: { createdBy: OTHER } } });

    expect(await runActorAuditBatch({ port }, UID, 10)).toBe("done");
    expect(store.teams?.t1).toEqual({ createdBy: OTHER });
  });
});

describe("validators accept a cleared actor field (TASK-024)", () => {
  const roadmapBase = {
    teamId: "team-alpha",
    treeId: "tree-1",
    targetNodeId: "node-1",
    priority: "high",
    status: "planned",
    createdAt: new Date("2026-08-01T08:00:00.000Z"),
    updatedAt: new Date("2026-08-02T08:00:00.000Z"),
  };

  it("accepts null for createdBy and updatedBy on a roadmap item", () => {
    expect(parseRoadmapItem({ ...roadmapBase, createdBy: null, updatedBy: null })).toMatchObject({
      createdBy: null,
      updatedBy: null,
    });
  });

  it("accepts null for archivedBy when archivedAt is present, keeping the pair", () => {
    const item = parseRoadmapItem({
      ...roadmapBase,
      createdBy: "admin-1",
      updatedBy: "admin-1",
      archivedAt: new Date("2026-08-03T08:00:00.000Z"),
      archivedBy: null,
    });
    expect(item).toMatchObject({ archivedBy: null, archivedAt: new Date("2026-08-03T08:00:00.000Z") });
  });

  it("still rejects a malformed roadmap actor: an empty string, a non-string, or a missing field", () => {
    expect(parseRoadmapItem({ ...roadmapBase, createdBy: "", updatedBy: "admin-1" })).toBeNull();
    expect(parseRoadmapItem({ ...roadmapBase, createdBy: 42, updatedBy: "admin-1" })).toBeNull();
    expect(parseRoadmapItem({ ...roadmapBase, updatedBy: "admin-1" })).toBeNull();
  });

  const progressBase = {
    teamId: "team-alpha",
    treeId: "tree-1",
    currentNodeId: null,
    updatedAt: new Date("2026-08-02T08:00:00.000Z"),
  };

  it("accepts null for skillProgress.updatedBy", () => {
    expect(isValidSkillProgress({ ...progressBase, updatedBy: null })).toBe(true);
  });

  it("still rejects a malformed skillProgress actor: an empty string or a non-string", () => {
    expect(isValidSkillProgress({ ...progressBase, updatedBy: "" })).toBe(false);
    expect(isValidSkillProgress({ ...progressBase, updatedBy: 7 })).toBe(false);
  });
});

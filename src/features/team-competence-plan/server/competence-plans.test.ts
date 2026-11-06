import { describe, expect, it, vi } from "vitest";
import { listCompetencePlans, upsertCompetencePlan, type CompetencePlanDeps, type CompetencePlanWriteTx } from "./competence-plans";
import { competencePlanDocId, type CompetencePlan } from "../domain/competence-plan";
import { competenceAreaDocId } from "../../team-competence-catalog/domain/competence-area";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const NOW = new Date("2026-06-01T09:00:00Z");
const EARLIER = new Date("2026-05-01T09:00:00Z");
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_NEW = "44444444-4444-4444-8444-444444444444";
const TREE = "tree-alpha";
const MEMBERSHIPS: Array<Record<string, unknown>> = [
  { uid: "uid-lead", teamId: "team-1", memberRef: "0123456789abcdefghjkmnpqrs", createdAt: EARLIER, role: "teamadmin" },
  { uid: "uid-member", teamId: "team-1", memberRef: "tvwxyz0123456789abcdefghjk", createdAt: EARLIER, role: "member" },
];

function areaDoc(teamId: string, treeId: string, status = "active") {
  return {
    teamId,
    treeId,
    status,
    sortOrder: 0,
    createdAt: EARLIER,
    updatedAt: EARLIER,
  };
}

function planDoc(overrides: Partial<CompetencePlan> = {}): CompetencePlan {
  return {
    teamId: "team-1",
    treeId: TREE,
    targetStage: 2,
    priority: "medium",
    archived: false,
    milestones: [{ id: ID_A, title: "Gammelt steg", targetDate: null, status: "in_progress" }],
    createdAt: EARLIER,
    updatedAt: EARLIER,
    ...overrides,
  };
}

interface World {
  teams?: Record<string, unknown>;
  areas?: Record<string, unknown>;
  plans?: Record<string, unknown>;
  callerUid?: string;
  verifies?: boolean;
}

function build(world: World = {}) {
  const teams = world.teams ?? { "team-1": "active" };
  const areas = new Map<string, unknown>(Object.entries(world.areas ?? { [competenceAreaDocId("team-1", TREE)]: areaDoc("team-1", TREE) }));
  const plans = new Map<string, unknown>(Object.entries(world.plans ?? {}));
  const puts: Array<{ id: string; data: CompetencePlan }> = [];

  const tx: CompetencePlanWriteTx = {
    async getMembership(uid, teamId) {
      return MEMBERSHIPS.find((m) => m.uid === uid && m.teamId === teamId);
    },
    async getTeamStatus(teamId) {
      return teams[teamId];
    },
    async getArea(docId) {
      return areas.get(docId);
    },
    async getPlan(docId) {
      return plans.get(docId);
    },
    putPlan(docId, record) {
      puts.push({ id: docId, data: record });
      plans.set(docId, record);
    },
  };

  const deps: CompetencePlanDeps = {
    verifyToken: world.verifies === false
      ? vi.fn().mockRejectedValue(new Error("bad token"))
      : vi.fn().mockResolvedValue({ uid: world.callerUid ?? "uid-lead", email: "x@example.test", email_verified: true }),
    isSuperadmin: async () => false,
    roleDeps: {
      isSuperadmin: async () => false,
      collection: {
        async getTeamStatus(teamId: string) {
          return teams[teamId];
        },
        async getMembership(uid: string, teamId: string) {
          return MEMBERSHIPS.find((m) => m.uid === uid && m.teamId === teamId);
        },
      },
    },
    readStore: {
      async listByTeam(teamId) {
        return [...plans.entries()]
          .filter(([, data]) => (data as { teamId?: string }).teamId === teamId)
          .map(([id, data]) => ({ id, data }));
      },
    },
    writeStore: {
      runTransaction: (fn) => fn(tx),
    },
    now: () => NOW,
    newId: () => ID_NEW,
  };
  return { deps, puts, plans };
}

const VALID_BODY = {
  targetStage: 3,
  priority: "high",
  archived: false,
  milestones: [{ title: "Sett opp testoppsett", targetDate: "2026-09-01", status: "planned" }],
};

describe("upsertCompetencePlan", () => {
  it("lets the lead of an active team create a plan for an assigned area, with no person field stored", async () => {
    const { deps, puts } = build();
    const result = await upsertCompetencePlan("token", "team-1", TREE, VALID_BODY, deps);
    expect(result.ok).toBe(true);
    expect(puts).toHaveLength(1);
    expect(puts[0].id).toBe(competencePlanDocId("team-1", TREE));
    expect(Object.keys(puts[0].data).sort()).toEqual(
      ["archived", "createdAt", "milestones", "priority", "targetStage", "teamId", "treeId", "updatedAt"].sort(),
    );
    expect(puts[0].data.targetStage).toBe(3);
    expect(puts[0].data.milestones).toEqual([{ id: ID_NEW, title: "Sett opp testoppsett", targetDate: "2026-09-01", status: "planned" }]);
  });

  it("refuses a team member, who cannot write a plan, and writes nothing", async () => {
    const { deps, puts } = build({ callerUid: "uid-member" });
    expect(await upsertCompetencePlan("token", "team-1", TREE, VALID_BODY, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(puts).toHaveLength(0);
  });

  it("refuses a lead of a disabled team", async () => {
    const { deps, puts } = build({ teams: { "team-1": "disabled" } });
    expect(await upsertCompetencePlan("token", "team-1", TREE, VALID_BODY, deps)).toEqual({ ok: false, error: "team_disabled" });
    expect(puts).toHaveLength(0);
  });

  it("refuses an area that is not assigned to the team", async () => {
    const { deps, puts } = build({ areas: {} });
    expect(await upsertCompetencePlan("token", "team-1", TREE, VALID_BODY, deps)).toEqual({ ok: false, error: "area_unavailable" });
    expect(puts).toHaveLength(0);
  });

  it("refuses an archived area", async () => {
    const { deps, puts } = build({ areas: { [competenceAreaDocId("team-1", TREE)]: areaDoc("team-1", TREE, "archived") } });
    expect(await upsertCompetencePlan("token", "team-1", TREE, VALID_BODY, deps)).toEqual({ ok: false, error: "area_archived" });
    expect(puts).toHaveLength(0);
  });

  it("refuses an invalid body with the validation issues and writes nothing", async () => {
    const { deps, puts } = build();
    const result = await upsertCompetencePlan("token", "team-1", TREE, { ...VALID_BODY, targetStage: 7 }, deps);
    expect(result).toEqual({ ok: false, error: "invalid_input", issues: ["target_stage_invalid"] });
    expect(puts).toHaveLength(0);
  });

  it("refuses a request with an unauthenticated token", async () => {
    const { deps, puts } = build({ verifies: false });
    const result = await upsertCompetencePlan("bad", "team-1", TREE, VALID_BODY, deps);
    expect(result.ok).toBe(false);
    expect(puts).toHaveLength(0);
  });

  it("keeps the stored milestone id and creation time when the lead replaces a plan", async () => {
    const existing = { [competencePlanDocId("team-1", TREE)]: planDoc() };
    const { deps, puts } = build({ plans: existing });
    const body = {
      ...VALID_BODY,
      milestones: [{ id: ID_A, title: "Oppdatert", targetDate: null, status: "completed" }],
    };
    const result = await upsertCompetencePlan("token", "team-1", TREE, body, deps);
    expect(result.ok).toBe(true);
    expect(puts[0].data.createdAt).toEqual(EARLIER);
    expect(puts[0].data.updatedAt).toEqual(NOW);
    expect(puts[0].data.milestones).toEqual([{ id: ID_A, title: "Oppdatert", targetDate: null, status: "completed" }]);
  });

  it("refuses a milestone id that the stored plan does not contain", async () => {
    const { deps, puts } = build({ plans: { [competencePlanDocId("team-1", TREE)]: planDoc() } });
    const body = { ...VALID_BODY, milestones: [{ id: ID_NEW, title: "Ukjent", targetDate: null, status: "planned" }] };
    const result = await upsertCompetencePlan("token", "team-1", TREE, body, deps);
    expect(result.ok).toBe(false);
    expect(puts).toHaveLength(0);
  });

  it("fails closed when the stored plan is malformed instead of overwriting it", async () => {
    const { deps, puts } = build({ plans: { [competencePlanDocId("team-1", TREE)]: { teamId: "team-1" } } });
    expect(await upsertCompetencePlan("token", "team-1", TREE, VALID_BODY, deps)).toEqual({ ok: false, error: "persistence_failed" });
    expect(puts).toHaveLength(0);
  });
});

describe("listCompetencePlans", () => {
  const plans = {
    [competencePlanDocId("team-1", "tree-b")]: planDoc({ treeId: "tree-b" }),
    [competencePlanDocId("team-1", "tree-c")]: planDoc({ treeId: "tree-c", archived: true }),
  };

  it("lets a member read active plans without the edit flag or any member data", async () => {
    const { deps } = build({ callerUid: "uid-member", plans });
    const result = await listCompetencePlans("token", "team-1", {}, deps);
    expect(result).toEqual({
      ok: true,
      canEdit: false,
      truncated: false,
      plans: [
        {
          treeId: "tree-b",
          targetStage: 2,
          priority: "medium",
          archived: false,
          milestones: [{ id: ID_A, title: "Gammelt steg", targetDate: null, status: "in_progress" }],
          progress: { completed: 0, total: 1 },
        },
      ],
    });
  });

  it("includes archived plans only when asked, and marks the lead as able to edit", async () => {
    const { deps } = build({ plans });
    const result = await listCompetencePlans("token", "team-1", { includeArchived: true }, deps);
    expect(result.ok && result.canEdit).toBe(true);
    expect(result.ok && result.plans.map((p) => p.treeId)).toEqual(["tree-b", "tree-c"]);
  });

  it("refuses a caller who holds no membership of the team", async () => {
    const { deps } = build({ callerUid: "uid-outsider", plans });
    expect(await listCompetencePlans("token", "team-1", {}, deps)).toEqual({ ok: false, error: "forbidden" });
  });

  it("fails the whole read when a stored plan is malformed rather than skipping it", async () => {
    const { deps } = build({ plans: { [competencePlanDocId("team-1", TREE)]: { teamId: "team-1", treeId: TREE } } });
    expect(await listCompetencePlans("token", "team-1", {}, deps)).toEqual({ ok: false, error: "read_failed" });
  });
});

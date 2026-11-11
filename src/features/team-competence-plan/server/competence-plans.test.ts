import { describe, expect, it, vi } from "vitest";
import {
  createCompetencePlan,
  listCompetencePlans,
  updateCompetencePlan,
  type CompetencePlanDeps,
  type CompetencePlanWriteTx,
} from "./competence-plans";
import type { CompetencePlan } from "../domain/competence-plan";

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
const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID_B = "22222222-2222-4222-8222-222222222222";
const MILESTONE_ID = "33333333-3333-4333-8333-333333333333";
const NEW_MILESTONE_ID = "44444444-4444-4444-8444-444444444444";
const TREE = "tree-alpha";
const MEMBERSHIPS: Array<Record<string, unknown>> = [
  { uid: "uid-lead", teamId: "team-1", memberRef: "0123456789abcdefghjkmnpqrs", createdAt: EARLIER, role: "teamadmin" },
  { uid: "uid-member", teamId: "team-1", memberRef: "tvwxyz0123456789abcdefghjk", createdAt: EARLIER, role: "member" },
];

function storedPlan(overrides: Partial<CompetencePlan> = {}): CompetencePlan {
  return {
    teamId: "team-1",
    title: "Testautomatisering",
    treeId: null,
    targetStage: 2,
    priority: "medium",
    archived: false,
    milestones: [{ id: MILESTONE_ID, title: "Gammelt steg", targetDate: null, status: "in_progress" }],
    createdAt: EARLIER,
    updatedAt: EARLIER,
    ...overrides,
  };
}

interface World {
  teams?: Record<string, unknown>;
  plans?: Record<string, unknown>;
  callerUid?: string;
  verifies?: boolean;
}

function build(world: World = {}) {
  const teams = world.teams ?? { "team-1": "active" };
  const plans = new Map<string, unknown>(Object.entries(world.plans ?? {}));
  const puts: Array<{ id: string; data: CompetencePlan }> = [];
  // Plan ids and milestone ids come from one generator, so each new value is distinct and deterministic.
  const generated = [PLAN_ID, NEW_MILESTONE_ID, PLAN_ID_B];
  let next = 0;

  const tx: CompetencePlanWriteTx = {
    async getMembership(uid, teamId) {
      return MEMBERSHIPS.find((m) => m.uid === uid && m.teamId === teamId);
    },
    async getTeamStatus(teamId) {
      return teams[teamId];
    },
    async getPlan(planId) {
      return plans.get(planId);
    },
    putPlan(planId, record) {
      puts.push({ id: planId, data: record });
      plans.set(planId, record);
    },
  };

  const deps: CompetencePlanDeps = {
    verifyToken:
      world.verifies === false
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
    newId: () => generated[next++] ?? `${next}`,
  };
  return { deps, puts, plans };
}

const VALID_BODY = {
  title: "  Sikkerhetsopplæring  ",
  targetStage: 3,
  priority: "high",
  archived: false,
  milestones: [{ title: "Sett opp testoppsett", targetDate: "2026-09-01", status: "planned" }],
};

describe("createCompetencePlan", () => {
  it("lets the lead of an active team create a plan with no competence area, stored under a fresh plan id", async () => {
    const { deps, puts } = build();
    const result = await createCompetencePlan("token", "team-1", VALID_BODY, deps);
    expect(result.ok).toBe(true);
    expect(puts).toHaveLength(1);
    expect(puts[0].id).toBe(PLAN_ID);
    expect(Object.keys(puts[0].data).sort()).toEqual(
      ["archived", "createdAt", "milestones", "priority", "targetStage", "teamId", "title", "treeId", "updatedAt"].sort(),
    );
    expect(puts[0].data.title).toBe("Sikkerhetsopplæring");
    expect(puts[0].data.treeId).toBeNull();
    expect(puts[0].data.milestones).toEqual([
      { id: NEW_MILESTONE_ID, title: "Sett opp testoppsett", targetDate: "2026-09-01", status: "planned" },
    ]);
  });

  it("refuses a team member, who cannot write a plan, and writes nothing", async () => {
    const { deps, puts } = build({ callerUid: "uid-member" });
    expect(await createCompetencePlan("token", "team-1", VALID_BODY, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(puts).toHaveLength(0);
  });

  it("refuses a lead of a disabled team", async () => {
    const { deps, puts } = build({ teams: { "team-1": "disabled" } });
    expect(await createCompetencePlan("token", "team-1", VALID_BODY, deps)).toEqual({ ok: false, error: "team_disabled" });
    expect(puts).toHaveLength(0);
  });

  it("refuses a missing or blank title with a title issue and writes nothing", async () => {
    const { deps, puts } = build();
    const result = await createCompetencePlan("token", "team-1", { ...VALID_BODY, title: "   " }, deps);
    expect(result).toEqual({ ok: false, error: "invalid_input", issues: ["title_invalid"] });
    expect(puts).toHaveLength(0);
  });

  it("refuses an invalid target stage and writes nothing", async () => {
    const { deps, puts } = build();
    const result = await createCompetencePlan("token", "team-1", { ...VALID_BODY, targetStage: 7 }, deps);
    expect(result).toEqual({ ok: false, error: "invalid_input", issues: ["target_stage_invalid"] });
    expect(puts).toHaveLength(0);
  });

  it("refuses an unauthenticated request and writes nothing", async () => {
    const { deps, puts } = build({ verifies: false });
    const result = await createCompetencePlan("bad", "team-1", VALID_BODY, deps);
    expect(result.ok).toBe(false);
    expect(puts).toHaveLength(0);
  });
});

describe("updateCompetencePlan", () => {
  it("replaces the editable fields of an existing plan and keeps its milestone id, label and creation time", async () => {
    const { deps, puts } = build({ plans: { [PLAN_ID]: storedPlan({ treeId: TREE }) } });
    const body = {
      ...VALID_BODY,
      title: "Ny tittel",
      milestones: [{ id: MILESTONE_ID, title: "Oppdatert", targetDate: null, status: "completed" }],
    };
    const result = await updateCompetencePlan("token", "team-1", PLAN_ID, body, deps);
    expect(result.ok).toBe(true);
    expect(puts[0].id).toBe(PLAN_ID);
    expect(puts[0].data.title).toBe("Ny tittel");
    expect(puts[0].data.treeId).toBe(TREE);
    expect(puts[0].data.createdAt).toEqual(EARLIER);
    expect(puts[0].data.updatedAt).toEqual(NOW);
    expect(puts[0].data.milestones).toEqual([{ id: MILESTONE_ID, title: "Oppdatert", targetDate: null, status: "completed" }]);
  });

  it("reports a plan id that is not stored as not found, and writes nothing", async () => {
    const { deps, puts } = build();
    expect(await updateCompetencePlan("token", "team-1", PLAN_ID, VALID_BODY, deps)).toEqual({ ok: false, error: "not_found" });
    expect(puts).toHaveLength(0);
  });

  it("reports a plan stored for another team as not found, so one team cannot edit another team's plan", async () => {
    const { deps, puts } = build({ plans: { [PLAN_ID]: storedPlan({ teamId: "team-2" }) } });
    expect(await updateCompetencePlan("token", "team-1", PLAN_ID, VALID_BODY, deps)).toEqual({ ok: false, error: "not_found" });
    expect(puts).toHaveLength(0);
  });

  it("refuses a milestone id that the stored plan does not contain", async () => {
    const { deps, puts } = build({ plans: { [PLAN_ID]: storedPlan() } });
    const body = { ...VALID_BODY, milestones: [{ id: NEW_MILESTONE_ID, title: "Ukjent", targetDate: null, status: "planned" }] };
    const result = await updateCompetencePlan("token", "team-1", PLAN_ID, body, deps);
    expect(result).toEqual({ ok: false, error: "invalid_input", issues: ["milestone_id_invalid"] });
    expect(puts).toHaveLength(0);
  });

  it("refuses a malformed plan id before any read", async () => {
    const { deps, puts } = build({ plans: { [PLAN_ID]: storedPlan() } });
    expect(await updateCompetencePlan("token", "team-1", "tree-alpha", VALID_BODY, deps)).toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(puts).toHaveLength(0);
  });

  it("refuses a team member, who cannot write a plan", async () => {
    const { deps, puts } = build({ callerUid: "uid-member", plans: { [PLAN_ID]: storedPlan() } });
    expect(await updateCompetencePlan("token", "team-1", PLAN_ID, VALID_BODY, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(puts).toHaveLength(0);
  });

  it("fails closed when the stored plan is malformed instead of overwriting it", async () => {
    const { deps, puts } = build({ plans: { [PLAN_ID]: { teamId: "team-1" } } });
    expect(await updateCompetencePlan("token", "team-1", PLAN_ID, VALID_BODY, deps)).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(puts).toHaveLength(0);
  });
});

describe("listCompetencePlans", () => {
  const plans = {
    [PLAN_ID]: storedPlan({ title: "Zeta" }),
    [PLAN_ID_B]: storedPlan({ title: "Alfa", archived: true }),
  };

  it("lets a member read active plans by title, without the edit flag or any member data", async () => {
    const { deps } = build({ callerUid: "uid-member", plans });
    const result = await listCompetencePlans("token", "team-1", {}, deps);
    expect(result).toEqual({
      ok: true,
      canEdit: false,
      truncated: false,
      plans: [
        {
          planId: PLAN_ID,
          title: "Zeta",
          treeId: null,
          targetStage: 2,
          priority: "medium",
          archived: false,
          milestones: [{ id: MILESTONE_ID, title: "Gammelt steg", targetDate: null, status: "in_progress" }],
          progress: { completed: 0, total: 1 },
        },
      ],
    });
  });

  it("includes archived plans only when asked, and marks the lead as able to edit", async () => {
    const { deps } = build({ plans });
    const result = await listCompetencePlans("token", "team-1", { includeArchived: true }, deps);
    expect(result.ok && result.canEdit).toBe(true);
    expect(result.ok && result.plans.map((p) => p.planId).sort()).toEqual([PLAN_ID, PLAN_ID_B].sort());
  });

  it("refuses a caller who holds no membership of the team", async () => {
    const { deps } = build({ callerUid: "uid-outsider", plans });
    expect(await listCompetencePlans("token", "team-1", {}, deps)).toEqual({ ok: false, error: "forbidden" });
  });

  it("fails the whole read when a stored plan is malformed rather than skipping it", async () => {
    const { deps } = build({ plans: { [PLAN_ID]: { teamId: "team-1", treeId: TREE } } });
    expect(await listCompetencePlans("token", "team-1", {}, deps)).toEqual({ ok: false, error: "read_failed" });
  });

  it("fails the read on a legacy plan document keyed by teamId__treeId, until the migration has moved it", async () => {
    const legacy = { ...storedPlan({ treeId: TREE }) };
    const { deps } = build({ plans: { [`team-1__${TREE}`]: legacy } });
    expect(await listCompetencePlans("token", "team-1", {}, deps)).toEqual({ ok: false, error: "read_failed" });
  });
});

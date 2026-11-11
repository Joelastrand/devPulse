import { describe, expect, it } from "vitest";
import {
  parseStoredCompetencePlan,
  planProgress,
  progressFillPercent,
  resolveMilestones,
  validatePlanInput,
  type PlanMilestone,
} from "./competence-plan";

const NOW = new Date("2026-06-01T09:00:00Z");
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

function milestone(overrides: Partial<PlanMilestone> = {}): PlanMilestone {
  return { id: ID_A, title: "Sett opp testoppsett", targetDate: "2026-09-01", status: "planned", ...overrides };
}

function storedPlan(overrides: Record<string, unknown> = {}) {
  return {
    teamId: "team-1",
    title: "Testautomatisering",
    treeId: null,
    targetStage: 3,
    priority: "high",
    archived: false,
    milestones: [milestone()],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const DOC_ID = "55555555-5555-4555-8555-555555555555";

describe("validatePlanInput", () => {
  const valid = {
    title: "  Sikkerhetsopplæring  ",
    targetStage: 3,
    priority: "high",
    archived: false,
    milestones: [{ title: "  Første steg  ", targetDate: "2026-09-01", status: "planned" }],
  };

  it("accepts a plan with an existing assessment level as target stage and trims milestone titles", () => {
    const result = validatePlanInput(valid);
    expect(result).toEqual({
      ok: true,
      value: {
        title: "Sikkerhetsopplæring",
        targetStage: 3,
        priority: "high",
        archived: false,
        milestones: [{ title: "Første steg", targetDate: "2026-09-01", status: "planned" }],
      },
    });
  });

  it("refuses a blank or over-long plan title, since a plan is named by its own title", () => {
    expect(validatePlanInput({ ...valid, title: "   " })).toEqual({ ok: false, issues: ["title_invalid"] });
    expect(validatePlanInput({ ...valid, title: "x".repeat(121) })).toEqual({ ok: false, issues: ["title_invalid"] });
  });

  it("rejects a target stage outside the four existing levels instead of coercing it", () => {
    expect(validatePlanInput({ ...valid, targetStage: 5 })).toEqual({ ok: false, issues: ["target_stage_invalid"] });
    expect(validatePlanInput({ ...valid, targetStage: 0 })).toEqual({ ok: false, issues: ["target_stage_invalid"] });
  });

  it("rejects an unknown priority and a non-boolean archived flag", () => {
    const result = validatePlanInput({ ...valid, priority: "urgent", archived: "no" });
    expect(result).toEqual({ ok: false, issues: ["priority_invalid", "archived_invalid"] });
  });

  it("refuses unknown top-level keys rather than ignoring them", () => {
    expect(validatePlanInput({ ...valid, createdBy: "uid-lead" }).ok).toBe(false);
  });

  it("refuses a milestone without a title", () => {
    const result = validatePlanInput({ ...valid, milestones: [{ title: "   ", targetDate: null, status: "planned" }] });
    expect(result).toEqual({ ok: false, issues: ["milestone_title_invalid"] });
  });

  it("refuses an impossible calendar date and an unknown milestone status", () => {
    const result = validatePlanInput({
      ...valid,
      milestones: [{ title: "Steg", targetDate: "2026-02-31", status: "done" }],
    });
    expect(result).toEqual({ ok: false, issues: ["milestone_date_invalid", "milestone_status_invalid"] });
  });

  it("refuses a duplicate milestone id", () => {
    const result = validatePlanInput({
      ...valid,
      milestones: [
        { id: ID_A, title: "A", targetDate: null, status: "planned" },
        { id: ID_A, title: "B", targetDate: null, status: "planned" },
      ],
    });
    expect(result).toEqual({ ok: false, issues: ["milestone_id_invalid"] });
  });

  it("refuses more milestones than the plan maximum", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ title: `Steg ${i}`, targetDate: null, status: "planned" }));
    expect(validatePlanInput({ ...valid, milestones: many })).toEqual({ ok: false, issues: ["milestones_invalid"] });
  });
});

describe("planProgress", () => {
  it("counts only completed milestones out of the total, never a skill level", () => {
    const progress = planProgress([
      milestone({ id: ID_A, status: "completed" }),
      milestone({ id: ID_B, status: "in_progress" }),
      milestone({ id: "33333333-3333-4333-8333-333333333333", status: "planned" }),
    ]);
    expect(progress).toEqual({ completed: 1, total: 3 });
  });

  it("reports zero of zero for a plan without milestones", () => {
    expect(planProgress([])).toEqual({ completed: 0, total: 0 });
  });
});

describe("parseStoredCompetencePlan", () => {
  it("accepts a well-formed stored plan", () => {
    expect(parseStoredCompetencePlan(storedPlan(), { docId: DOC_ID })?.targetStage).toBe(3);
  });

  it("refuses a document whose id is not a plan UUID, such as a legacy teamId__treeId id", () => {
    expect(parseStoredCompetencePlan(storedPlan(), { docId: "team-1__tree-alpha" })).toBeNull();
  });

  it("refuses a stored target stage that is not an existing level rather than defaulting it", () => {
    expect(parseStoredCompetencePlan(storedPlan({ targetStage: 9 }), { docId: DOC_ID })).toBeNull();
  });

  it("refuses a stored document that carries an extra person-linked key", () => {
    expect(parseStoredCompetencePlan(storedPlan({ updatedBy: "uid-lead" }), { docId: DOC_ID })).toBeNull();
  });

  it("refuses a stored milestone with an unknown status", () => {
    const plan = storedPlan({ milestones: [milestone({ status: "done" as never })] });
    expect(parseStoredCompetencePlan(plan, { docId: DOC_ID })).toBeNull();
  });
});

describe("resolveMilestones", () => {
  it("keeps ids of existing milestones and issues a new id for a new one", () => {
    const result = resolveMilestones(
      [
        { id: ID_A, title: "Bestående", targetDate: null, status: "completed" },
        { title: "Nytt", targetDate: null, status: "planned" },
      ],
      [milestone({ id: ID_A })],
      () => ID_B,
    );
    expect(result).toEqual({
      ok: true,
      milestones: [
        { id: ID_A, title: "Bestående", targetDate: null, status: "completed" },
        { id: ID_B, title: "Nytt", targetDate: null, status: "planned" },
      ],
    });
  });

  it("refuses an id that does not belong to the stored plan", () => {
    const result = resolveMilestones(
      [{ id: ID_B, title: "Ukjent", targetDate: null, status: "planned" }],
      [milestone({ id: ID_A })],
      () => {
        throw new Error("no new id may be generated for an unknown client id");
      },
    );
    expect(result).toEqual({ ok: false });
  });
});

describe("progressFillPercent", () => {
  it.each([
    [0, 4, 0],
    [1, 4, 25],
    [2, 4, 50],
    [3, 4, 75],
    [4, 4, 100],
    [1, 3, 100 / 3],
  ])("maps %i of %i completed to %s%%", (completed, total, expected) => {
    expect(progressFillPercent({ completed, total })).toBeCloseTo(expected, 10);
  });

  it("is zero when a plan has no milestones, never complete", () => {
    expect(progressFillPercent({ completed: 0, total: 0 })).toBe(0);
  });
});

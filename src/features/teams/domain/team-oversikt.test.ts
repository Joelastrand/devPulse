import { describe, expect, it } from "vitest";
import {
  buildOversiktNextSteps,
  completeHeaderCount,
  countActiveProjects,
  countPriorityPlans,
  OVERSIKT_NEXT_STEPS_LIMIT,
} from "./team-oversikt";

describe("countActiveProjects (TASK-008, BR-2)", () => {
  it("counts only non-archived projects whose effective status is active", () => {
    expect(
      countActiveProjects([
        { archived: false, effectiveStatus: "active" },
        { archived: false, effectiveStatus: "planned" },
        { archived: false, effectiveStatus: "completed" },
        { archived: true, effectiveStatus: "active" },
      ]),
    ).toBe(1);
  });

  it("returns 0 only for a real empty list", () => {
    expect(countActiveProjects([])).toBe(0);
  });
});

describe("countPriorityPlans (TASK-008, BR-1)", () => {
  it("counts non-archived high-priority plans and ignores medium, low and archived plans", () => {
    expect(
      countPriorityPlans([
        { archived: false, priority: "high" },
        { archived: false, priority: "medium" },
        { archived: false, priority: "low" },
        { archived: true, priority: "high" },
      ]),
    ).toBe(1);
  });
});

describe("buildOversiktNextSteps (TASK-008, BR-3, BR-4)", () => {
  it("returns at most three items, in fixed importance order, omitting zero counts", () => {
    const steps = buildOversiktNextSteps({ systemsNeedingAttention: 2, priorityPlans: 1, activeProjects: 3 });
    expect(steps.map((step) => step.kind)).toEqual(["systems", "competence-plan", "roadmap"]);
    expect(steps.length).toBeLessThanOrEqual(OVERSIKT_NEXT_STEPS_LIMIT);
  });

  it("omits zero counts instead of listing an empty instruction", () => {
    const steps = buildOversiktNextSteps({ systemsNeedingAttention: 0, priorityPlans: 1, activeProjects: 0 });
    expect(steps).toEqual([{ kind: "competence-plan", count: 1 }]);
  });

  it("never invents a step from an unavailable read (null)", () => {
    expect(buildOversiktNextSteps({ systemsNeedingAttention: null, priorityPlans: null, activeProjects: null })).toEqual([]);
  });
});

describe("completeHeaderCount", () => {
  it("returns the count for a complete read", () => {
    expect(completeHeaderCount({ count: 12, truncated: false })).toBe(12);
  });

  it("returns a zero for a complete empty read, never null", () => {
    expect(completeHeaderCount({ count: 0, truncated: false })).toBe(0);
  });

  it("omits a truncated count instead of understating the total", () => {
    expect(completeHeaderCount({ count: 50, truncated: true })).toBeNull();
  });

  it("returns null when the read failed or is absent", () => {
    expect(completeHeaderCount(null)).toBeNull();
  });
});

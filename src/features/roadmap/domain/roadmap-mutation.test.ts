import { describe, expect, it } from "vitest";
import { isLegacyReadOnlyPlan, planEditingContext, type MutablePlanFacts } from "./roadmap-mutation";

function plan(overrides: Partial<MutablePlanFacts> = {}): MutablePlanFacts {
  return {
    treeId: "tree-1",
    areaName: "Containers",
    status: "active",
    completedAt: null,
    tracking: { state: "tracked" },
    ...overrides,
  };
}

const area = { treeId: "tree-1", name: "Containers", currentNodeId: "n1", nodes: [] };

describe("isLegacyReadOnlyPlan", () => {
  it("is true only for completed plans without completedAt", () => {
    expect(isLegacyReadOnlyPlan({ status: "completed", completedAt: null })).toBe(true);
    expect(isLegacyReadOnlyPlan({ status: "completed", completedAt: "2026-03-01T00:00:00.000Z" })).toBe(false);
    expect(isLegacyReadOnlyPlan({ status: "active", completedAt: null })).toBe(false);
    expect(isLegacyReadOnlyPlan({ status: "planned", completedAt: null })).toBe(false);
  });
});

describe("planEditingContext", () => {
  it("uses the skills-read area for a tracked plan", () => {
    expect(planEditingContext(plan(), [area], "Ukjent")).toEqual({ area, targetLocked: false });
  });

  it("keeps a completed plan with a valid completedAt editable", () => {
    const completed = plan({ status: "completed", completedAt: "2026-03-01T00:00:00.000Z" });
    expect(planEditingContext(completed, [area], "Ukjent")).not.toBeNull();
  });

  it("is read-only for a legacy completed plan, tracked or not", () => {
    const legacy = plan({ status: "completed" });
    expect(planEditingContext(legacy, [area], "Ukjent")).toBeNull();
    expect(planEditingContext({ ...legacy, tracking: { state: "not_tracked" } }, [], "Ukjent")).toBeNull();
  });

  it("is read-only for a tracked plan whose area is missing from the skills read", () => {
    expect(planEditingContext(plan(), [], "Ukjent")).toBeNull();
  });

  it("builds a locked synthetic area for an untracked plan without reading the skills list", () => {
    expect(planEditingContext(plan({ tracking: { state: "not_tracked" }, areaName: null }), [], "Ukjent")).toEqual({
      area: { treeId: "tree-1", name: "Ukjent", currentNodeId: null, nodes: [] },
      targetLocked: true,
    });
  });
});

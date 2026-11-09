import { describe, expect, it } from "vitest";
import type { MilestoneStatus, PlanMilestone } from "./competence-plan";
import { addMonths, buildPlanTimeline, nextPlanSteps } from "./plan-timeline";

function m(id: string, targetDate: string | null, status: MilestoneStatus = "planned"): PlanMilestone {
  return { id, title: id, targetDate, status };
}

const NOV_2026 = { year: 2026, month: 11 };

describe("addMonths", () => {
  it("rolls the year over", () => {
    expect(addMonths(NOV_2026, 3)).toEqual({ year: 2027, month: 2 });
    expect(addMonths(NOV_2026, 6)).toEqual({ year: 2027, month: 5 });
  });
});

describe("buildPlanTimeline", () => {
  it("creates one column per month of the span", () => {
    expect(buildPlanTimeline([], NOV_2026, 3).months).toHaveLength(3);
    expect(buildPlanTimeline([], NOV_2026, 6).months.at(-1)).toEqual({ year: 2027, month: 4 });
  });

  it("places a bar across the dated milestones and clips it to the window", () => {
    const timeline = buildPlanTimeline([{ treeId: "t", milestones: [m("a", "2026-11-01"), m("b", "2027-02-01")] }], NOV_2026, 3);
    const row = timeline.rows[0];
    expect(row.bar?.startPct).toBeCloseTo(0, 5);
    // Window is Nov 1 2026 – Feb 1 2027 (92 days); the last milestone sits on the window's end boundary (clipped).
    expect(row.bar?.widthPct).toBeGreaterThan(90);
    expect(row.markers.map((x) => x.id)).toEqual(["a"]);
  });

  it("returns no bar and no markers for a plan outside the window", () => {
    const row = buildPlanTimeline([{ treeId: "t", milestones: [m("a", "2025-01-10")] }], NOV_2026, 3).rows[0];
    expect(row.bar).toBeNull();
    expect(row.markers).toEqual([]);
  });

  it("keeps a row without dated milestones, with no bar", () => {
    const row = buildPlanTimeline([{ treeId: "t", milestones: [m("a", null)] }], NOV_2026, 6).rows[0];
    expect(row).toEqual({ treeId: "t", bar: null, markers: [] });
  });

  it("positions a marker proportionally inside the window", () => {
    const row = buildPlanTimeline([{ treeId: "t", milestones: [m("a", "2026-12-01", "completed")] }], NOV_2026, 3).rows[0];
    // Dec 1 is 30 days into the 92-day Nov–Jan window.
    expect(row.markers[0].pct).toBeCloseTo((30 / 92) * 100, 5);
    expect(row.markers[0].status).toBe("completed");
  });
});

describe("nextPlanSteps", () => {
  it("lists open steps earliest first, skips completed and archived plans, undated last", () => {
    const steps = nextPlanSteps(
      [
        { treeId: "a", archived: false, milestones: [m("late", "2027-03-01"), m("done", "2026-09-01", "completed"), m("none", null)] },
        { treeId: "b", archived: false, milestones: [m("early", "2026-12-01", "in_progress")] },
        { treeId: "c", archived: true, milestones: [m("archived", "2026-10-01")] },
      ],
      10,
    );
    expect(steps.map((s) => s.milestone.id)).toEqual(["early", "late", "none"]);
  });

  it("applies the limit", () => {
    const steps = nextPlanSteps([{ treeId: "a", archived: false, milestones: [m("x", "2026-12-01"), m("y", "2027-01-01")] }], 1);
    expect(steps.map((s) => s.milestone.id)).toEqual(["x"]);
  });
});

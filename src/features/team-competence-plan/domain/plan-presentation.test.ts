import { describe, expect, it } from "vitest";
import type { MilestoneStatus, PlanMilestone } from "./competence-plan";
import { formatPlanDate, planCardStatus } from "./plan-presentation";

function steps(...statuses: MilestoneStatus[]): PlanMilestone[] {
  return statuses.map((status, index) => ({ id: `m${index}`, title: "Steg", targetDate: null, status }));
}

describe("planCardStatus", () => {
  it("reports a plan without steps as no_steps", () => {
    expect(planCardStatus([])).toBe("no_steps");
  });

  it("reports all-planned steps as not_started", () => {
    expect(planCardStatus(steps("planned", "planned"))).toBe("not_started");
  });

  it("reports any started step as in_progress", () => {
    expect(planCardStatus(steps("completed", "planned"))).toBe("in_progress");
    expect(planCardStatus(steps("in_progress", "planned"))).toBe("in_progress");
  });

  it("reports completed only when every step is completed", () => {
    expect(planCardStatus(steps("completed", "completed"))).toBe("completed");
  });
});

describe("formatPlanDate", () => {
  it("formats a stored plan date as a Norwegian label", () => {
    expect(formatPlanDate("2027-01-15")).toBe("15. jan. 2027");
  });

  it("keeps the calendar day for the first and last day of a month", () => {
    expect(formatPlanDate("2026-12-01")).toBe("1. des. 2026");
    expect(formatPlanDate("2027-02-28")).toBe("28. feb. 2027");
  });

  it("returns null for no date or an invalid date", () => {
    expect(formatPlanDate(null)).toBeNull();
    expect(formatPlanDate("2027-13-40")).toBeNull();
    expect(formatPlanDate("not-a-date")).toBeNull();
  });
});

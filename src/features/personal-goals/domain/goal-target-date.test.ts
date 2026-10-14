import { describe, expect, it } from "vitest";
import { isValidPlanDate } from "../../roadmap/domain/roadmap-dates";
import { isValidGoalTargetDate } from "./goal-target-date";

describe("isValidGoalTargetDate", () => {
  it.each(["2026-10-11", "2020-01-01", "2100-12-31", "2024-02-29"])(
    "accepts %s",
    (value) => {
      expect(isValidGoalTargetDate(value)).toBe(true);
    },
  );

  it("accepts past dates (no future-only rule, no overdue concept)", () => {
    expect(isValidGoalTargetDate("2020-01-01")).toBe(true);
  });

  it.each([
    ["2026-02-30", "impossible calendar day"],
    ["2025-02-29", "non-leap-year leap day"],
    ["2026-13-01", "month 13"],
    ["2026-00-10", "month 0"],
    ["2019-12-31", "before year 2020"],
    ["2101-01-01", "after year 2100"],
    ["26-1-1", "short form"],
    ["2026-1-01", "unpadded month"],
    ["2026/10/11", "wrong separator"],
    ["2026-10-11T00:00:00Z", "timestamp form"],
    [" 2026-10-11", "leading space"],
    ["", "empty"],
  ])("rejects %s (%s)", (value) => {
    expect(isValidGoalTargetDate(value)).toBe(false);
  });

  it.each([[undefined], [null], [20261011], [new Date()], [{}]])("rejects non-string %j", (value) => {
    expect(isValidGoalTargetDate(value)).toBe(false);
  });

  it("agrees with isValidPlanDate over a shared fixture table", () => {
    const fixtures = [
      "2026-10-11",
      "2020-01-01",
      "2100-12-31",
      "2024-02-29",
      "2025-02-29",
      "2019-12-31",
      "2101-01-01",
      "2026-02-30",
      "26-1-1",
      "",
      "2026-10-11T00:00:00Z",
    ];
    for (const value of fixtures) {
      expect(isValidGoalTargetDate(value)).toBe(isValidPlanDate(value));
    }
  });
});

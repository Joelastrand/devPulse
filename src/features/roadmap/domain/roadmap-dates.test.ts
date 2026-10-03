import { describe, expect, it } from "vitest";
import { isOverdue, isValidPlanDate, planningToday, validatePlanDateRange } from "./roadmap-dates";

describe("isValidPlanDate", () => {
  it("accepts real calendar dates including leap days and the year bounds", () => {
    for (const d of ["2026-06-01", "2024-02-29", "2020-01-01", "2100-12-31"]) {
      expect(isValidPlanDate(d)).toBe(true);
    }
  });

  it("rejects impossible, out-of-range and malformed values", () => {
    for (const d of ["2026-02-30", "2025-02-29", "2100-02-29", "2019-12-31", "2101-01-01", "2026-13-01", "2026-00-10", "2026-6-1", "2026-06-01T00:00:00Z", "", "x", null, undefined, 20260601, new Date()]) {
      expect(isValidPlanDate(d)).toBe(false);
    }
  });
});

describe("validatePlanDateRange", () => {
  it("accepts none, start only, target only and both in order (or equal)", () => {
    expect(validatePlanDateRange(undefined, undefined)).toBe(true);
    expect(validatePlanDateRange("2026-06-01", undefined)).toBe(true);
    expect(validatePlanDateRange(undefined, "2026-06-01")).toBe(true);
    expect(validatePlanDateRange("2026-06-01", "2026-06-01")).toBe(true);
    expect(validatePlanDateRange("2026-06-01", "2026-09-01")).toBe(true);
  });

  it("rejects start after target and any invalid member", () => {
    expect(validatePlanDateRange("2026-09-02", "2026-09-01")).toBe(false);
    expect(validatePlanDateRange("2026-02-30", undefined)).toBe(false);
    expect(validatePlanDateRange(undefined, "2101-01-01")).toBe(false);
  });
});

describe("planningToday / isOverdue (Europe/Oslo calendar date)", () => {
  it("uses the Oslo date, not UTC, across the midnight boundary (summer, UTC+2)", () => {
    expect(planningToday(new Date("2026-06-01T21:59:59Z"))).toBe("2026-06-01");
    expect(planningToday(new Date("2026-06-01T22:00:00Z"))).toBe("2026-06-02");
  });

  it("uses the Oslo date in winter (UTC+1)", () => {
    expect(planningToday(new Date("2026-01-15T22:59:59Z"))).toBe("2026-01-15");
    expect(planningToday(new Date("2026-01-15T23:00:00Z"))).toBe("2026-01-16");
  });

  it("is overdue only when the target date is strictly before today", () => {
    expect(isOverdue({ targetDate: "2026-06-01", status: "active" }, "2026-06-02")).toBe(true);
    expect(isOverdue({ targetDate: "2026-06-01", status: "planned" }, "2026-06-01")).toBe(false);
    expect(isOverdue({ targetDate: "2026-06-01", status: "planned" }, "2026-05-31")).toBe(false);
  });

  it("is never overdue when completed or without a target date", () => {
    expect(isOverdue({ targetDate: "2026-01-01", status: "completed" }, "2026-06-02")).toBe(false);
    expect(isOverdue({ status: "active" }, "2026-06-02")).toBe(false);
  });
});

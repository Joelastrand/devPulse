import { describe, expect, it } from "vitest";
import { isValidPlanDate, normalizePlannedFor } from "./plan-date";

describe("isValidPlanDate (BR-6)", () => {
  it.each(["2020-01-01", "2026-10-14", "2100-12-31", "2024-02-29"])("accepts %s", (value) => {
    expect(isValidPlanDate(value)).toBe(true);
  });

  it.each([
    "2019-12-31",
    "2101-01-01",
    "2026-02-30",
    "2025-02-29",
    "2100-02-29",
    "2026-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-1-01",
    "2026-10-14T00:00:00Z",
    "2026-10-14 ",
    "14.10.2026",
    "",
  ])("rejects %j", (value) => {
    expect(isValidPlanDate(value)).toBe(false);
  });

  it("rejects non-strings", () => {
    for (const value of [null, undefined, 20261014, new Date(0)]) {
      expect(isValidPlanDate(value)).toBe(false);
    }
  });
});

describe("normalizePlannedFor", () => {
  it("treats null and absence as no planned date", () => {
    expect(normalizePlannedFor(null)).toEqual({ ok: true, value: null });
    expect(normalizePlannedFor(undefined)).toEqual({ ok: true, value: null });
  });

  it("returns a valid date unchanged", () => {
    expect(normalizePlannedFor("2026-10-14")).toEqual({ ok: true, value: "2026-10-14" });
  });

  it("rejects any other value", () => {
    expect(normalizePlannedFor("")).toEqual({ ok: false });
    expect(normalizePlannedFor("2026-02-30")).toEqual({ ok: false });
    expect(normalizePlannedFor(0)).toEqual({ ok: false });
  });
});

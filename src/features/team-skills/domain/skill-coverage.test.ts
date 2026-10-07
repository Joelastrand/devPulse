import { describe, expect, it } from "vitest";
import { SKILL_COVERAGE_MIN_CONTRIBUTORS } from "./skill-coverage-policy";
import { deriveCoverageState, type CoverageRowState, type CoverageState } from "./skill-coverage";

const k = SKILL_COVERAGE_MIN_CONTRIBUTORS;
const cohort = (n: number, level = 4) => Array.from({ length: n }, () => level);

describe("deriveCoverageState", () => {
  it.each([0, 1, k - 1])("returns insufficient_data for %s contributors", (n) => {
    expect(deriveCoverageState({ requiredLevel: 2, requiredCoverage: 1, levels: cohort(n) })).toBe(
      "insufficient_data",
    );
  });

  it.each([k, k + 1, 12])("evaluates at %s contributors", (n) => {
    expect(deriveCoverageState({ requiredLevel: 2, requiredCoverage: 1, levels: cohort(n) })).toBe("covered");
    expect(deriveCoverageState({ requiredLevel: 4, requiredCoverage: 1, levels: cohort(n, 1) })).toBe("gap");
  });

  it("compares levels with >= requiredLevel", () => {
    const levels = [1, 2, 3, 4, 4];
    expect(deriveCoverageState({ requiredLevel: 2, requiredCoverage: 4, levels })).toBe("covered");
    expect(deriveCoverageState({ requiredLevel: 2, requiredCoverage: 5, levels })).toBe("gap");
    expect(deriveCoverageState({ requiredLevel: 3, requiredCoverage: 3, levels })).toBe("covered");
    expect(deriveCoverageState({ requiredLevel: 3, requiredCoverage: 4, levels })).toBe("gap");
    expect(deriveCoverageState({ requiredLevel: 4, requiredCoverage: 2, levels })).toBe("covered");
    expect(deriveCoverageState({ requiredLevel: 4, requiredCoverage: 3, levels })).toBe("gap");
  });

  it("is covered at exactly requiredCoverage and gap one fewer", () => {
    const levels = [3, 3, 3, 1, 1];
    expect(deriveCoverageState({ requiredLevel: 3, requiredCoverage: 3, levels })).toBe("covered");
    expect(deriveCoverageState({ requiredLevel: 3, requiredCoverage: 4, levels })).toBe("gap");
  });

  it("returns gap, not insufficient_data, when requiredCoverage exceeds the cohort", () => {
    expect(deriveCoverageState({ requiredLevel: 2, requiredCoverage: 8, levels: cohort(5) })).toBe("gap");
  });

  it("applies the threshold before requiredCoverage even when it would be met", () => {
    expect(deriveCoverageState({ requiredLevel: 2, requiredCoverage: 1, levels: cohort(k - 1) })).toBe(
      "insufficient_data",
    );
  });

  it("throws on malformed requiredLevel", () => {
    for (const requiredLevel of [1, 0, 5, 2.5, "3", null, undefined, NaN]) {
      expect(() =>
        deriveCoverageState({ requiredLevel: requiredLevel as never, requiredCoverage: 1, levels: cohort(5) }),
      ).toThrow();
    }
  });

  it("throws on malformed requiredCoverage", () => {
    for (const requiredCoverage of [0, 21, 1.5, "2", null, undefined, NaN, Infinity]) {
      expect(() =>
        deriveCoverageState({ requiredLevel: 2, requiredCoverage: requiredCoverage as never, levels: cohort(5) }),
      ).toThrow();
    }
  });

  it("throws on malformed contributor levels, including 0 for unassessed", () => {
    for (const bad of [0, 5, -1, 2.5, "3", null, undefined, NaN, Infinity]) {
      expect(() =>
        deriveCoverageState({ requiredLevel: 2, requiredCoverage: 1, levels: [...cohort(5), bad as never] }),
      ).toThrow();
    }
    expect(() => deriveCoverageState({ requiredLevel: 2, requiredCoverage: 1, levels: null as never })).toThrow();
  });

  it("represents unassessed contributors by absence", () => {
    // Four assessed contributors, however many are unassessed (absent), stay below k.
    expect(deriveCoverageState({ requiredLevel: 2, requiredCoverage: 1, levels: cohort(4) })).toBe(
      "insufficient_data",
    );
  });

  it("returns only a bare categorical string, never counts or identity", () => {
    const result = deriveCoverageState({ requiredLevel: 2, requiredCoverage: 1, levels: cohort(6) });
    expect(typeof result).toBe("string");
    expect(["covered", "gap", "insufficient_data"]).toContain(result);
  });

  it("can never produce area_unavailable", () => {
    // @ts-expect-error area_unavailable is outside CoverageState
    const notAState: CoverageState = "area_unavailable";
    const row: CoverageRowState = "area_unavailable";
    expect(notAState).toBe(row);
    for (let n = 0; n <= 25; n += 1) {
      for (const requiredLevel of [2, 3, 4] as const) {
        for (const requiredCoverage of [1, 5, 20]) {
          for (const level of [1, 2, 3, 4]) {
            const state = deriveCoverageState({ requiredLevel, requiredCoverage, levels: cohort(n, level) });
            expect(state).not.toBe("area_unavailable");
          }
        }
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import { SKILL_COVERAGE_MIN_CONTRIBUTORS } from "./skill-coverage-policy";
import { deriveTeamLevel } from "./team-level";

/** Independent reference: largest integer m with m − 1/2 ≤ sum/n, decided without division. */
function referenceLevel(levels: readonly number[]): number {
  const n = levels.length;
  const sum = levels.reduce((a, b) => a + b, 0);
  let m = 0;
  for (let candidate = 1; candidate <= 4; candidate++) {
    if (2 * candidate * n - n <= 2 * sum) m = candidate;
  }
  return m;
}

/** Every ordered sequence of length n over the levels 1–4. */
function allSequences(n: number): number[][] {
  if (n === 0) return [[]];
  return allSequences(n - 1).flatMap((prefix) => [1, 2, 3, 4].map((level) => [...prefix, level]));
}

describe("deriveTeamLevel: exhaustive arithmetic", () => {
  it.each([3, 4, 5])("matches the reference for every sequence of %s contributors", (n) => {
    for (const levels of allSequences(n)) {
      const result = deriveTeamLevel(levels, 3);
      expect(result).toEqual({ state: "value", level: referenceLevel(levels) });
    }
  });

  it("is independent of contributor order", () => {
    for (const levels of allSequences(4)) {
      const sorted = [...levels].sort((a, b) => a - b);
      expect(deriveTeamLevel(levels, 3)).toEqual(deriveTeamLevel(sorted, 3));
    }
  });

  it("always returns a level in 1–4 for valid input", () => {
    for (const levels of allSequences(5)) {
      const result = deriveTeamLevel(levels, 3);
      expect(result.state).toBe("value");
      if (result.state === "value") expect([1, 2, 3, 4]).toContain(result.level);
    }
  });
});

describe("deriveTeamLevel: rounding", () => {
  it.each([
    [[1, 1, 2, 2], 2], // mean 1.5 rounds up
    [[1, 1, 1, 2], 1], // mean 1.25 rounds down
    [[3, 3, 4, 4], 4], // mean 3.5 rounds up
    [[1, 2, 3], 2], // mean 2 exactly
    [[1, 1, 2], 1], // mean 1.33 rounds down
    [[2, 3, 3], 3], // mean 2.67 rounds up
  ])("rounds %j to %s", (levels, expected) => {
    expect(deriveTeamLevel(levels, 3)).toEqual({ state: "value", level: expected });
  });
});

describe("deriveTeamLevel: threshold boundaries", () => {
  it("returns insufficient_data at two contributors with k = 3", () => {
    expect(deriveTeamLevel([1, 4], 3)).toEqual({ state: "insufficient_data" });
  });

  it("evaluates at three contributors with k = 3", () => {
    expect(deriveTeamLevel([1, 4, 4], 3)).toEqual({ state: "value", level: 3 });
  });

  it("keeps the currently enforced k = 5 unchanged", () => {
    expect(SKILL_COVERAGE_MIN_CONTRIBUTORS).toBe(5);
    expect(deriveTeamLevel([4, 4, 4, 4], SKILL_COVERAGE_MIN_CONTRIBUTORS)).toEqual({ state: "insufficient_data" });
    expect(deriveTeamLevel([4, 4, 4, 4, 4], SKILL_COVERAGE_MIN_CONTRIBUTORS)).toEqual({ state: "value", level: 4 });
  });

  it("returns insufficient_data for zero and one contributor, never a level", () => {
    expect(deriveTeamLevel([], 3)).toEqual({ state: "insufficient_data" });
    expect(deriveTeamLevel([2], 3)).toEqual({ state: "insufficient_data" });
  });

  it("returns only the state or the level, with no count or sum", () => {
    expect(Object.keys(deriveTeamLevel([1, 2, 3], 3)).sort()).toEqual(["level", "state"]);
    expect(Object.keys(deriveTeamLevel([1, 2], 3)).sort()).toEqual(["state"]);
  });
});

describe("deriveTeamLevel: invalid input throws", () => {
  it.each([
    [[0, 3, 3]],
    [[5, 3, 3]],
    [[2.5, 3, 3]],
    [["2", 3, 3]],
    [[null, 3, 3]],
    [[undefined, 3, 3]],
    [[NaN, 3, 3]],
  ])("rejects a malformed level in %j", (levels) => {
    expect(() => deriveTeamLevel(levels as never, 3)).toThrow(TypeError);
  });

  it("rejects a non-array input", () => {
    expect(() => deriveTeamLevel(undefined as never, 3)).toThrow(TypeError);
  });

  it.each([2, 1, 0, -3, 2.5, NaN, Infinity])("rejects a threshold of %s", (minContributors) => {
    expect(() => deriveTeamLevel([1, 1, 1], minContributors)).toThrow(TypeError);
  });
});

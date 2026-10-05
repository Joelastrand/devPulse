import { describe, expect, it } from "vitest";

import {
  SELF_ASSESSED_LEVELS,
  SELF_ASSESSED_LEVEL_MEANINGS,
  isSelfAssessedLevel,
} from "./self-assessed-level";

describe("isSelfAssessedLevel", () => {
  it.each([1, 2, 3, 4])("accepts %s", (value) => {
    expect(isSelfAssessedLevel(value)).toBe(true);
  });

  it.each<[string, unknown]>([
    ["zero (unassessed is absence, never 0)", 0],
    ["negative", -1],
    ["five", 5],
    ["large", 100],
    ["fraction", 2.5],
    ["fraction just above 1", 1.0000001],
    ["numeric string", "3"],
    ["arbitrary string", "høy"],
    ["empty string", ""],
    ["true", true],
    ["false", false],
    ["null", null],
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["array", [3]],
    ["object", { level: 3 }],
    ["boxed number", Object(3)],
    ["bigint", BigInt(3)],
  ])("rejects %s", (_name, value) => {
    expect(isSelfAssessedLevel(value)).toBe(false);
  });
});

describe("canonical scale (BR-4)", () => {
  it("is exactly the four ordered integers 1–4, with no level 0", () => {
    expect([...SELF_ASSESSED_LEVELS]).toEqual([1, 2, 3, 4]);
    expect(SELF_ASSESSED_LEVELS).not.toContain(0);
  });

  it("defines a canonical meaning for every level and no other key", () => {
    expect(Object.keys(SELF_ASSESSED_LEVEL_MEANINGS).sort()).toEqual(["1", "2", "3", "4"]);
    for (const level of SELF_ASSESSED_LEVELS) {
      expect(SELF_ASSESSED_LEVEL_MEANINGS[level].meaning.length).toBeGreaterThan(0);
    }
  });

  it("maps the approved meanings to the right levels", () => {
    const m = (l: 1 | 2 | 3 | 4) => SELF_ASSESSED_LEVEL_MEANINGS[l].meaning.toLowerCase();
    expect(m(1)).toMatch(/limited|early/);
    expect(m(2)).toMatch(/support|guidance/);
    expect(m(3)).toMatch(/independent/);
    expect(m(4)).toMatch(/deep|advanced/);
    expect(m(4)).toMatch(/complex|unfamiliar/);
  });

  it("does not define level 4 by mentoring; mentoring is only an example", () => {
    const level4 = SELF_ASSESSED_LEVEL_MEANINGS[4];
    expect(level4.meaning).not.toMatch(/mentor|guid|teach|coach/i);
    expect(level4.example).toMatch(/guid|mentor/i);
    for (const level of [1, 2, 3] as const) {
      expect(SELF_ASSESSED_LEVEL_MEANINGS[level].meaning).not.toMatch(/mentor|teach|coach/i);
    }
  });

  it("exposes no arithmetic over levels", async () => {
    const mod = await import("./self-assessed-level");
    expect(Object.keys(mod).filter((k) => /average|(^|_)mean($|_)|(^|[a-z])sum|score|percent|rank|weight/i.test(k))).toEqual([]);
  });
});

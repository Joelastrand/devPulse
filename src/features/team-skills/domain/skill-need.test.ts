import { describe, expect, it } from "vitest";
import {
  SKILL_NEED_PERSISTED_KEYS,
  isValidSkillNeed,
  parseSkillNeedInput,
  skillNeedDocId,
} from "./skill-need";

const now = new Date("2026-01-01T00:00:00Z");
const valid = () => ({
  teamId: "team1",
  treeId: "tree-1",
  requiredLevel: 3,
  requiredCoverage: 2,
  createdAt: now,
  updatedAt: now,
});
const docId = "team1__tree-1";

describe("skill need record", () => {
  it("has exactly the six persisted keys", () => {
    expect(Object.keys(SKILL_NEED_PERSISTED_KEYS).sort()).toEqual([
      "createdAt",
      "requiredCoverage",
      "requiredLevel",
      "teamId",
      "treeId",
      "updatedAt",
    ]);
  });

  it("builds the deterministic id", () => {
    expect(skillNeedDocId("team1", "tree-1")).toBe(docId);
  });

  it("accepts a valid matching record", () => {
    expect(isValidSkillNeed(valid(), { docId })).toBe(true);
  });

  it("rejects a mismatching doc id", () => {
    expect(isValidSkillNeed(valid(), { docId: "team2__tree-1" })).toBe(false);
    expect(isValidSkillNeed(valid(), { docId: "" })).toBe(false);
  });

  it.each([2, 3, 4])("accepts requiredLevel %s", (requiredLevel) => {
    expect(isValidSkillNeed({ ...valid(), requiredLevel }, { docId })).toBe(true);
  });

  it.each([1, 0, 5, 6, -2, 2.5, "3", true, null, undefined, NaN, Infinity])(
    "rejects requiredLevel %s",
    (requiredLevel) => {
      expect(isValidSkillNeed({ ...valid(), requiredLevel }, { docId })).toBe(false);
    },
  );

  it.each([1, 20])("accepts requiredCoverage %s", (requiredCoverage) => {
    expect(isValidSkillNeed({ ...valid(), requiredCoverage }, { docId })).toBe(true);
  });

  it.each([0, 21, -1, 1.5, "2", true, null, undefined, NaN, Infinity])(
    "rejects requiredCoverage %s",
    (requiredCoverage) => {
      expect(isValidSkillNeed({ ...valid(), requiredCoverage }, { docId })).toBe(false);
    },
  );

  it("rejects malformed tree and team ids", () => {
    expect(isValidSkillNeed({ ...valid(), treeId: "bad id" }, { docId: "team1__bad id" })).toBe(false);
    expect(isValidSkillNeed({ ...valid(), treeId: 5 }, { docId })).toBe(false);
    expect(isValidSkillNeed({ ...valid(), teamId: "" }, { docId: "__tree-1" })).toBe(false);
    expect(isValidSkillNeed({ ...valid(), teamId: 1 }, { docId })).toBe(false);
  });

  it("rejects invalid timestamps", () => {
    for (const bad of [new Date("nope"), "2026-01-01", 0, null, undefined, {}]) {
      expect(isValidSkillNeed({ ...valid(), createdAt: bad }, { docId })).toBe(false);
      expect(isValidSkillNeed({ ...valid(), updatedAt: bad }, { docId })).toBe(false);
    }
  });

  it("rejects missing and extra keys", () => {
    const missing: Record<string, unknown> = valid();
    delete missing.updatedAt;
    expect(isValidSkillNeed(missing, { docId })).toBe(false);
    expect(isValidSkillNeed({ ...valid(), createdBy: "u" }, { docId })).toBe(false);
  });

  it("never throws on malformed external data", () => {
    const hostile = {
      get teamId(): string {
        throw new Error("boom");
      },
    };
    for (const data of [null, undefined, 1, "x", [], hostile, Object.create({ a: 1 })]) {
      expect(() => isValidSkillNeed(data, { docId })).not.toThrow();
      expect(isValidSkillNeed(data, { docId })).toBe(false);
    }
    expect(() => isValidSkillNeed(valid(), undefined as never)).not.toThrow();
  });
});

describe("parseSkillNeedInput", () => {
  it("accepts a valid body", () => {
    expect(parseSkillNeedInput({ requiredLevel: 4, requiredCoverage: 20 })).toEqual({
      ok: true,
      requiredLevel: 4,
      requiredCoverage: 20,
    });
  });

  it.each([null, undefined, "x", 1, [], [2, 1]])("treats non-object body %j as invalid_request", (body) => {
    expect(parseSkillNeedInput(body)).toEqual({ ok: false, error: "invalid_request" });
  });

  it("treats missing and extra keys as invalid_request", () => {
    expect(parseSkillNeedInput({ requiredLevel: 3 })).toEqual({ ok: false, error: "invalid_request" });
    expect(parseSkillNeedInput({ requiredCoverage: 3 })).toEqual({ ok: false, error: "invalid_request" });
    expect(parseSkillNeedInput({})).toEqual({ ok: false, error: "invalid_request" });
    expect(parseSkillNeedInput({ requiredLevel: 3, requiredCoverage: 2, k: 1 })).toEqual({
      ok: false,
      error: "invalid_request",
    });
  });

  it.each([
    [1, 2],
    [5, 2],
    ["3", 2],
    [3, "2"],
    [3, 0],
    [3, 21],
    [2.5, 2],
    [3, 1.5],
    [null, 2],
    [3, null],
    [true, 2],
    [3, NaN],
    [Infinity, 2],
  ])("treats values (%j, %j) as invalid_input without coercion", (requiredLevel, requiredCoverage) => {
    expect(parseSkillNeedInput({ requiredLevel, requiredCoverage })).toEqual({ ok: false, error: "invalid_input" });
  });
});

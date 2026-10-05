import { describe, expect, it } from "vitest";

import {
  SKILL_PROFILE_PERSISTED_KEYS,
  hasValidCreatedAt,
  isWellFormedTreeId,
  readSkillProfileRecord,
  selectVisibleLevels,
} from "./skill-profile";

describe("isWellFormedTreeId", () => {
  it.each(["a", "abc123", "Team_Skill-1", "A".repeat(128), "-", "_"])("accepts %s", (id) => {
    expect(isWellFormedTreeId(id)).toBe(true);
  });

  it.each<[string, unknown]>([
    ["empty", ""],
    ["129 characters", "A".repeat(129)],
    ["space", "a b"],
    ["slash", "a/b"],
    ["dot", "a.b"],
    ["leading space", " a"],
    ["trailing newline", "abc\n"],
    ["non-ASCII letter", "kompetanseområde"],
    ["non-string", 5],
    ["null", null],
    ["undefined", undefined],
  ])("rejects %s", (_n, id) => {
    expect(isWellFormedTreeId(id)).toBe(false);
  });

  it("is purely syntactic: existence or catalog visibility is not considered", () => {
    expect(isWellFormedTreeId("not-in-any-catalog")).toBe(true);
  });
});

describe("readSkillProfileRecord", () => {
  it("treats an absent document as a readable empty profile", () => {
    expect(readSkillProfileRecord(undefined)).toEqual({ readable: true, levels: {} });
  });

  it("treats absent levels as a readable empty map", () => {
    expect(readSkillProfileRecord({})).toEqual({ readable: true, levels: {} });
  });

  it("treats an empty plain-object levels as readable", () => {
    expect(readSkillProfileRecord({ levels: {} })).toEqual({ readable: true, levels: {} });
  });

  it("keeps entries of a plain-object levels untouched, including invalid ones", () => {
    const levels = { a: 3, b: 0, c: "3", d: null };
    const result = readSkillProfileRecord({ levels });
    expect(result).toEqual({ readable: true, levels });
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["array", [1, 2]],
    ["empty array", []],
    ["string", "x"],
    ["number", 5],
    ["boolean", true],
    ["Date", new Date()],
    ["Map", new Map()],
  ])("treats levels = %s as unreadable", (_n, levels) => {
    expect(readSkillProfileRecord({ levels })).toEqual({ readable: false });
  });

  it("accepts a null-prototype levels object", () => {
    const levels = Object.assign(Object.create(null), { a: 2 });
    expect(readSkillProfileRecord({ levels })).toEqual({ readable: true, levels });
  });

  it.each<[string, Record<string, unknown>]>([
    ["missing timestamps", { levels: { a: 1 } }],
    ["invalid createdAt", { levels: { a: 1 }, createdAt: "yesterday", updatedAt: 5 }],
    ["null timestamps", { levels: { a: 1 }, createdAt: null, updatedAt: null }],
    ["invalid Date", { levels: { a: 1 }, createdAt: new Date("nope"), updatedAt: new Date("nope") }],
  ])("timestamps never affect readability (%s)", (_n, doc) => {
    expect(readSkillProfileRecord(doc)).toEqual({ readable: true, levels: { a: 1 } });
  });

  it("ignores unknown top-level fields", () => {
    const result = readSkillProfileRecord({ levels: { a: 4 }, extra: "x", uid: "u1" });
    expect(result).toEqual({ readable: true, levels: { a: 4 } });
  });
});

describe("hasValidCreatedAt", () => {
  const timestampLike = (d: Date) => ({ toDate: () => d });

  it("accepts a valid Date and a valid Timestamp-like value", () => {
    expect(hasValidCreatedAt({ createdAt: new Date("2026-01-01T00:00:00Z") })).toBe(true);
    expect(hasValidCreatedAt({ createdAt: timestampLike(new Date("2026-01-01T00:00:00Z")) })).toBe(true);
  });

  it.each<[string, unknown]>([
    ["absent document", undefined],
    ["missing field", {}],
    ["null", { createdAt: null }],
    ["string", { createdAt: "2026-01-01" }],
    ["number", { createdAt: 1767225600000 }],
    ["invalid Date", { createdAt: new Date("nope") }],
    ["Timestamp-like with invalid date", { createdAt: { toDate: () => new Date("nope") } }],
    ["Timestamp-like that throws", { createdAt: { toDate: () => { throw new Error("x"); } } }],
    ["object without toDate", { createdAt: {} }],
  ])("reports invalid for %s", (_n, doc) => {
    expect(hasValidCreatedAt(doc as Record<string, unknown> | undefined)).toBe(false);
  });

  it("is independent of readability and of updatedAt", () => {
    expect(hasValidCreatedAt({ levels: null, createdAt: new Date("2026-01-01") })).toBe(true);
    expect(hasValidCreatedAt({ updatedAt: new Date("2026-01-01") })).toBe(false);
  });
});

describe("SKILL_PROFILE_PERSISTED_KEYS", () => {
  it("is exactly levels, createdAt, updatedAt", () => {
    expect([...SKILL_PROFILE_PERSISTED_KEYS].sort()).toEqual(["createdAt", "levels", "updatedAt"]);
  });
});

describe("selectVisibleLevels", () => {
  it("returns the level per visible skill and null when unassessed", () => {
    const result = selectVisibleLevels(["a", "b", "c"], { a: 1, c: 4 });
    expect(result.get("a")).toBe(1);
    expect(result.get("b")).toBeNull();
    expect(result.get("c")).toBe(4);
    expect([...result.keys()]).toEqual(["a", "b", "c"]);
  });

  it("ignores keys outside the visible set", () => {
    const result = selectVisibleLevels(["a"], { a: 2, hidden: 3 });
    expect([...result.keys()]).toEqual(["a"]);
    expect(result.get("a")).toBe(2);
  });

  it.each<[string, unknown]>([
    ["0", 0],
    ["5", 5],
    ['"3"', "3"],
    ["2.5", 2.5],
    ["null", null],
    ["NaN", Number.NaN],
    ["array", [3]],
    ["object", { level: 3 }],
  ])("ignores an invalid value %s without coercing it", (_n, value) => {
    expect(selectVisibleLevels(["a"], { a: value }).get("a")).toBeNull();
  });

  it("does not read inherited properties for prototype-like tree ids", () => {
    const result = selectVisibleLevels(["constructor", "toString", "__proto__"], {});
    expect([...result.values()]).toEqual([null, null, null]);
  });

  it("reads own prototype-like keys", () => {
    const levels = JSON.parse('{"constructor": 3, "__proto__": 2}') as Record<string, unknown>;
    const result = selectVisibleLevels(["constructor", "__proto__"], levels);
    expect(result.get("constructor")).toBe(3);
    expect(result.get("__proto__")).toBe(2);
  });

  it("handles empty input", () => {
    expect(selectVisibleLevels([], { a: 1 }).size).toBe(0);
    expect(selectVisibleLevels(["a"], {}).get("a")).toBeNull();
  });
});

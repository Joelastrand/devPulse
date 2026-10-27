import { describe, expect, it } from "vitest";
import { hasExactKeys, isPlainObject, isStoredDate, parseCanonicalInstant } from "./stored-shape";

const KEYS = ["a", "b"] as const;

describe("isPlainObject", () => {
  it("accepts object literals and null-prototype objects (the D1 convention)", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
  });

  it.each([null, undefined, "x", 1, true, [], new Date(0), new (class Thing {})(), () => ({})])(
    "rejects %#",
    (value) => {
      expect(isPlainObject(value)).toBe(false);
    },
  );
});

describe("hasExactKeys", () => {
  it("accepts exactly the listed data keys", () => {
    expect(hasExactKeys({ a: 1, b: null }, KEYS)).toBe(true);
  });

  it("rejects missing, extra, undefined, inherited and symbol keys", () => {
    expect(hasExactKeys({ a: 1 }, KEYS)).toBe(false);
    expect(hasExactKeys({ a: 1, b: 2, c: 3 }, KEYS)).toBe(false);
    expect(hasExactKeys({ a: 1, b: undefined }, KEYS)).toBe(false);
    expect(hasExactKeys(Object.assign(Object.create({ a: 1 }) as object, { b: 2 }) as Record<string, unknown>, KEYS)).toBe(false);
    expect(hasExactKeys({ a: 1, b: 2, [Symbol("synthetic")]: 3 }, KEYS)).toBe(false);
  });

  it("rejects a non-enumerable extra own key, which Object.keys would miss", () => {
    const value: Record<string, unknown> = { a: 1, b: 2 };
    Object.defineProperty(value, "hidden", { value: 3, enumerable: false });
    expect(hasExactKeys(value, KEYS)).toBe(false);
  });

  it("rejects an accessor property and never invokes its getter", () => {
    let calls = 0;
    const value = { a: 1, get b() {
      calls += 1;
      return 2;
    } };
    expect(hasExactKeys(value, KEYS)).toBe(false);
    expect(calls).toBe(0);
  });
});

describe("isStoredDate", () => {
  it("accepts a valid Date and rejects invalid Dates, strings and numbers", () => {
    expect(isStoredDate(new Date(0))).toBe(true);
    expect(isStoredDate(new Date("nope"))).toBe(false);
    expect(isStoredDate("2026-10-14T08:30:00.000Z")).toBe(false);
    expect(isStoredDate(0)).toBe(false);
  });
});

describe("parseCanonicalInstant (round-trip ISO-8601 only)", () => {
  it("accepts the exact toISOString form and returns the instant", () => {
    expect(parseCanonicalInstant("2026-10-14T08:30:00.000Z")).toEqual(new Date("2026-10-14T08:30:00.000Z"));
  });

  it.each([
    "2026-10-14T08:30:00Z",
    "2026-10-14T10:30:00.000+02:00",
    "2026-10-14",
    "2026-10-14 08:30:00.000Z",
    "not a date",
    "",
    " 2026-10-14T08:30:00.000Z",
  ])("rejects %j", (value) => {
    expect(parseCanonicalInstant(value)).toBeNull();
  });

  it.each([null, 1789380600000, new Date(0)])("rejects non-string %#", (value) => {
    expect(parseCanonicalInstant(value)).toBeNull();
  });
});

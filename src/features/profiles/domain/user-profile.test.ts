import { describe, expect, it } from "vitest";
import { isValidUserProfile } from "./user-profile";

const now = new Date("2026-01-01T00:00:00Z");
const valid = { displayName: "Anna Berg", createdAt: now, updatedAt: now };

describe("isValidUserProfile", () => {
  it("accepts a canonical profile", () => {
    expect(isValidUserProfile(valid)).toBe(true);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["an array", []],
    ["a string", "Anna"],
  ])("rejects a non-object document (%s)", (_label, data) => {
    expect(isValidUserProfile(data)).toBe(false);
  });

  it.each([
    ["wrong type", { ...valid, displayName: 7 }],
    ["too short", { ...valid, displayName: "A" }],
    ["not normalised (padding)", { ...valid, displayName: " Anna " }],
    ["contains a newline", { ...valid, displayName: "Anna\nBerg" }],
    ["missing", { createdAt: now, updatedAt: now }],
  ])("rejects an invalid displayName (%s)", (_label, data) => {
    expect(isValidUserProfile(data)).toBe(false);
  });

  it("rejects missing or non-Date timestamps", () => {
    expect(isValidUserProfile({ ...valid, createdAt: undefined })).toBe(false);
    expect(isValidUserProfile({ ...valid, updatedAt: "2026-01-01" })).toBe(false);
    expect(isValidUserProfile({ ...valid, updatedAt: new Date("nope") })).toBe(false);
  });
});

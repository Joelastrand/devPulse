import { describe, expect, it } from "vitest";
import { isValidTeamStatus } from "./team";

describe("isValidTeamStatus", () => {
  it("accepts 'active'", () => {
    expect(isValidTeamStatus("active")).toBe(true);
  });

  it("accepts 'disabled'", () => {
    expect(isValidTeamStatus("disabled")).toBe(true);
  });

  it("rejects an unrecognized status string", () => {
    expect(isValidTeamStatus("archived")).toBe(false);
  });

  it("rejects non-string values, including undefined for a missing/nonexistent document", () => {
    expect(isValidTeamStatus(undefined)).toBe(false);
    expect(isValidTeamStatus(null)).toBe(false);
    expect(isValidTeamStatus(42)).toBe(false);
    expect(isValidTeamStatus({})).toBe(false);
  });
});

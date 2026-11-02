import { describe, expect, it } from "vitest";
import { isRecentAuth } from "./recent-auth";

const WINDOW = 300;
const NOW = 1_800_000_000;

describe("isRecentAuth", () => {
  it("accepts a sign-in made moments ago", () => {
    expect(isRecentAuth(NOW - 10, NOW, WINDOW)).toBe(true);
  });

  it("accepts a sign-in at exactly the window boundary (<= window)", () => {
    expect(isRecentAuth(NOW - WINDOW, NOW, WINDOW)).toBe(true);
  });

  it("rejects a sign-in one second older than the window", () => {
    expect(isRecentAuth(NOW - WINDOW - 1, NOW, WINDOW)).toBe(false);
  });

  it("rejects a token with an old auth_time, so a stale bearer token cannot start an erasure", () => {
    expect(isRecentAuth(NOW - 24 * 60 * 60, NOW, WINDOW)).toBe(false);
  });

  it("rejects a missing auth_time as not recent", () => {
    expect(isRecentAuth(undefined, NOW, WINDOW)).toBe(false);
  });

  it("rejects a non-finite auth_time as not recent", () => {
    expect(isRecentAuth(Number.NaN, NOW, WINDOW)).toBe(false);
    expect(isRecentAuth(Number.POSITIVE_INFINITY, NOW, WINDOW)).toBe(false);
  });

  it("rejects an auth_time in the future", () => {
    expect(isRecentAuth(NOW + 1, NOW, WINDOW)).toBe(false);
  });

  it("uses the window passed by the caller, not a fixed value", () => {
    expect(isRecentAuth(NOW - 600, NOW, 60)).toBe(false);
    expect(isRecentAuth(NOW - 600, NOW, 600)).toBe(true);
  });
});

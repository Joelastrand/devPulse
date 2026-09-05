import { describe, expect, it } from "vitest";
import { validateSubmission } from "./validation";

const validPayload = {
  answers: [1, 5, 3],
  teamId: "platform",
};

describe("validateSubmission", () => {
  it("accepts a payload with three in-range answers and an allowed teamId", () => {
    const result = validateSubmission(validPayload);
    expect(result).toEqual({
      ok: true,
      data: { answers: [1, 5, 3], teamId: "platform" },
    });
  });

  it("rejects a missing answer", () => {
    const result = validateSubmission({ answers: [1, 5], teamId: "platform" });
    expect(result).toEqual({ ok: false, error: "invalid_submission" });
  });

  it("rejects an out-of-range answer", () => {
    const result = validateSubmission({
      answers: [1, 6, 3],
      teamId: "platform",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a zero answer", () => {
    const result = validateSubmission({
      answers: [0, 5, 3],
      teamId: "platform",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-numeric answer", () => {
    const result = validateSubmission({
      answers: [1, "5", 3],
      teamId: "platform",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-integer answer", () => {
    const result = validateSubmission({
      answers: [1, 2.5, 3],
      teamId: "platform",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a missing teamId", () => {
    const result = validateSubmission({ answers: [1, 5, 3] });
    expect(result).toEqual({ ok: false, error: "invalid_submission" });
  });

  it("rejects a teamId not in the allowed set", () => {
    const result = validateSubmission({
      answers: [1, 5, 3],
      teamId: "not-a-real-team",
    });
    expect(result).toEqual({ ok: false, error: "invalid_submission" });
  });

  it("rejects a non-object payload", () => {
    expect(validateSubmission(null).ok).toBe(false);
    expect(validateSubmission("not an object").ok).toBe(false);
    expect(validateSubmission(undefined).ok).toBe(false);
  });

  it("does not leak which specific field failed", () => {
    const missingAnswer = validateSubmission({
      answers: [1, 5],
      teamId: "platform",
    });
    const badTeam = validateSubmission({
      answers: [1, 5, 3],
      teamId: "nope",
    });
    expect(missingAnswer).toEqual(badTeam);
  });
});

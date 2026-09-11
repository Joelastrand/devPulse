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

  it("accepts any structurally valid (non-empty string) teamId — active-team membership is validated separately, server-side against Firestore", () => {
    const result = validateSubmission({
      answers: [1, 5, 3],
      teamId: "some-opaque-firestore-id",
    });
    expect(result).toEqual({
      ok: true,
      data: { answers: [1, 5, 3], teamId: "some-opaque-firestore-id" },
    });
  });

  it("rejects a non-string teamId", () => {
    const result = validateSubmission({ answers: [1, 5, 3], teamId: 42 });
    expect(result).toEqual({ ok: false, error: "invalid_submission" });
  });

  it("rejects a blank teamId", () => {
    const result = validateSubmission({ answers: [1, 5, 3], teamId: "   " });
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
    const blankTeam = validateSubmission({
      answers: [1, 5, 3],
      teamId: "",
    });
    expect(missingAnswer).toEqual(blankTeam);
  });
});

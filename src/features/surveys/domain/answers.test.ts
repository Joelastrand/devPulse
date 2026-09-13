import { describe, expect, it } from "vitest";
import { validateSurveyAnswers } from "./answers";

describe("validateSurveyAnswers", () => {
  it("accepts three in-range integer answers", () => {
    const result = validateSurveyAnswers([1, 5, 3]);
    expect(result).toEqual({ ok: true, data: [1, 5, 3] });
  });

  it("rejects a missing answer", () => {
    const result = validateSurveyAnswers([1, 5]);
    expect(result).toEqual({ ok: false, error: "invalid_answers" });
  });

  it("rejects an extra answer", () => {
    const result = validateSurveyAnswers([1, 5, 3, 2]);
    expect(result).toEqual({ ok: false, error: "invalid_answers" });
  });

  it("rejects an out-of-range answer", () => {
    expect(validateSurveyAnswers([1, 6, 3]).ok).toBe(false);
  });

  it("rejects a zero answer", () => {
    expect(validateSurveyAnswers([0, 5, 3]).ok).toBe(false);
  });

  it("rejects a non-numeric answer", () => {
    expect(validateSurveyAnswers([1, "5", 3]).ok).toBe(false);
  });

  it("rejects a non-integer answer", () => {
    expect(validateSurveyAnswers([1, 2.5, 3]).ok).toBe(false);
  });

  it("rejects a non-array payload", () => {
    expect(validateSurveyAnswers(null).ok).toBe(false);
    expect(validateSurveyAnswers(undefined).ok).toBe(false);
    expect(validateSurveyAnswers({ answers: [1, 5, 3] }).ok).toBe(false);
  });

  it("does not leak which specific element failed", () => {
    const missing = validateSurveyAnswers([1, 5]);
    const outOfRange = validateSurveyAnswers([1, 5, 9]);
    expect(missing).toEqual(outOfRange);
  });
});

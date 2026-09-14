import { describe, expect, it } from "vitest";
import {
  CHALLENGE_TEXT_MAX_LENGTH,
  CHALLENGE_TEXT_MIN_LENGTH,
  validateChallengeText,
} from "./challenge-text";

describe("validateChallengeText", () => {
  it("accepts ordinary text", () => {
    const result = validateChallengeText("Deploy process has no clear owner.");
    expect(result).toEqual({
      ok: true,
      text: "Deploy process has no clear owner.",
    });
  });

  it("trims leading/trailing whitespace before returning text", () => {
    const result = validateChallengeText("  hello world  ");
    expect(result).toEqual({ ok: true, text: "hello world" });
  });

  it("preserves internal whitespace unchanged", () => {
    const result = validateChallengeText("a  b   c");
    expect(result).toEqual({ ok: true, text: "a  b   c" });
  });

  it("accepts the minimum boundary length (3 trimmed characters)", () => {
    const text = "a".repeat(CHALLENGE_TEXT_MIN_LENGTH);
    expect(validateChallengeText(text)).toEqual({ ok: true, text });
  });

  it("rejects one character below the minimum boundary", () => {
    const text = "a".repeat(CHALLENGE_TEXT_MIN_LENGTH - 1);
    expect(validateChallengeText(text)).toEqual({ ok: false, error: "invalid_input" });
  });

  it("accepts the maximum boundary length (2000 trimmed characters)", () => {
    const text = "a".repeat(CHALLENGE_TEXT_MAX_LENGTH);
    expect(validateChallengeText(text)).toEqual({ ok: true, text });
  });

  it("rejects one character above the maximum boundary", () => {
    const text = "a".repeat(CHALLENGE_TEXT_MAX_LENGTH + 1);
    expect(validateChallengeText(text)).toEqual({ ok: false, error: "invalid_input" });
  });

  it("does not truncate an over-length value", () => {
    const text = "a".repeat(CHALLENGE_TEXT_MAX_LENGTH + 50);
    const result = validateChallengeText(text);
    expect(result.ok).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(validateChallengeText("")).toEqual({ ok: false, error: "invalid_input" });
  });

  it("rejects whitespace-only input", () => {
    expect(validateChallengeText("   \n\t  ")).toEqual({ ok: false, error: "invalid_input" });
  });

  it("rejects non-string input, never throwing", () => {
    expect(validateChallengeText(undefined)).toEqual({ ok: false, error: "invalid_input" });
    expect(validateChallengeText(null)).toEqual({ ok: false, error: "invalid_input" });
    expect(validateChallengeText(42)).toEqual({ ok: false, error: "invalid_input" });
    expect(validateChallengeText({})).toEqual({ ok: false, error: "invalid_input" });
    expect(validateChallengeText(["a valid looking string"])).toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(() => validateChallengeText(Symbol("x"))).not.toThrow();
  });

  it("does not attach identity-shaped fields to the normalized input, even if present on a malicious raw payload", () => {
    const maliciousPayload = {
      toString: () => "not actually a string",
      uid: "attacker-uid",
    };
    const result = validateChallengeText(maliciousPayload);
    expect(result).toEqual({ ok: false, error: "invalid_input" });
  });
});

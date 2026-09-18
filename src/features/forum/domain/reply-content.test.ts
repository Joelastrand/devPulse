import { describe, expect, it } from "vitest";
import { REPLY_BODY_MAX_LENGTH, REPLY_BODY_MIN_LENGTH, validateReplyBody } from "./reply-content";

describe("validateReplyBody", () => {
  it("accepts ordinary text", () => {
    expect(validateReplyBody("We hit the same issue last sprint.")).toEqual({
      ok: true,
      body: "We hit the same issue last sprint.",
    });
  });

  it("trims leading/trailing whitespace before returning the body", () => {
    expect(validateReplyBody("  hello world  ")).toEqual({ ok: true, body: "hello world" });
  });

  it("preserves internal whitespace unchanged", () => {
    expect(validateReplyBody("a  b   c")).toEqual({ ok: true, body: "a  b   c" });
  });

  it("accepts the minimum boundary length", () => {
    const body = "a".repeat(REPLY_BODY_MIN_LENGTH);
    expect(validateReplyBody(body)).toEqual({ ok: true, body });
  });

  it("rejects one character below the minimum boundary", () => {
    const body = "a".repeat(REPLY_BODY_MIN_LENGTH - 1);
    expect(validateReplyBody(body)).toEqual({ ok: false, error: "invalid_input" });
  });

  it("accepts the maximum boundary length", () => {
    const body = "a".repeat(REPLY_BODY_MAX_LENGTH);
    expect(validateReplyBody(body)).toEqual({ ok: true, body });
  });

  it("rejects one character above the maximum boundary", () => {
    const body = "a".repeat(REPLY_BODY_MAX_LENGTH + 1);
    expect(validateReplyBody(body)).toEqual({ ok: false, error: "invalid_input" });
  });

  it("does not truncate an over-length value", () => {
    const body = "a".repeat(REPLY_BODY_MAX_LENGTH + 50);
    expect(validateReplyBody(body).ok).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(validateReplyBody("")).toEqual({ ok: false, error: "invalid_input" });
  });

  it("rejects whitespace-only input", () => {
    expect(validateReplyBody("   \n\t  ")).toEqual({ ok: false, error: "invalid_input" });
  });

  it("rejects non-string input, never throwing", () => {
    expect(validateReplyBody(undefined)).toEqual({ ok: false, error: "invalid_input" });
    expect(validateReplyBody(null)).toEqual({ ok: false, error: "invalid_input" });
    expect(validateReplyBody(42)).toEqual({ ok: false, error: "invalid_input" });
    expect(validateReplyBody({})).toEqual({ ok: false, error: "invalid_input" });
    expect(validateReplyBody(["a valid looking string"])).toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(() => validateReplyBody(Symbol("x"))).not.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import {
  THREAD_BODY_MAX_LENGTH,
  THREAD_BODY_MIN_LENGTH,
  THREAD_TITLE_MAX_LENGTH,
  THREAD_TITLE_MIN_LENGTH,
  validateThreadBody,
  validateThreadTitle,
} from "./thread-content";

describe("validateThreadTitle", () => {
  it("accepts ordinary text", () => {
    expect(validateThreadTitle("Has anyone solved the flaky deploy job?")).toEqual({
      ok: true,
      title: "Has anyone solved the flaky deploy job?",
    });
  });

  it("trims leading/trailing whitespace before returning the title", () => {
    expect(validateThreadTitle("  hello world  ")).toEqual({ ok: true, title: "hello world" });
  });

  it("preserves internal whitespace unchanged", () => {
    expect(validateThreadTitle("a  b   c")).toEqual({ ok: true, title: "a  b   c" });
  });

  it("accepts the minimum boundary length", () => {
    const title = "a".repeat(THREAD_TITLE_MIN_LENGTH);
    expect(validateThreadTitle(title)).toEqual({ ok: true, title });
  });

  it("rejects one character below the minimum boundary", () => {
    const title = "a".repeat(THREAD_TITLE_MIN_LENGTH - 1);
    expect(validateThreadTitle(title)).toEqual({ ok: false, error: "invalid_input" });
  });

  it("accepts the maximum boundary length", () => {
    const title = "a".repeat(THREAD_TITLE_MAX_LENGTH);
    expect(validateThreadTitle(title)).toEqual({ ok: true, title });
  });

  it("rejects one character above the maximum boundary", () => {
    const title = "a".repeat(THREAD_TITLE_MAX_LENGTH + 1);
    expect(validateThreadTitle(title)).toEqual({ ok: false, error: "invalid_input" });
  });

  it("does not truncate an over-length value", () => {
    const title = "a".repeat(THREAD_TITLE_MAX_LENGTH + 50);
    expect(validateThreadTitle(title).ok).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(validateThreadTitle("")).toEqual({ ok: false, error: "invalid_input" });
  });

  it("rejects whitespace-only input", () => {
    expect(validateThreadTitle("   \n\t  ")).toEqual({ ok: false, error: "invalid_input" });
  });

  it("rejects non-string input, never throwing", () => {
    expect(validateThreadTitle(undefined)).toEqual({ ok: false, error: "invalid_input" });
    expect(validateThreadTitle(null)).toEqual({ ok: false, error: "invalid_input" });
    expect(validateThreadTitle(42)).toEqual({ ok: false, error: "invalid_input" });
    expect(validateThreadTitle({})).toEqual({ ok: false, error: "invalid_input" });
    expect(() => validateThreadTitle(Symbol("x"))).not.toThrow();
  });
});

describe("validateThreadBody", () => {
  it("accepts ordinary text", () => {
    expect(validateThreadBody("Our on-call rotation has no clear owner.")).toEqual({
      ok: true,
      body: "Our on-call rotation has no clear owner.",
    });
  });

  it("trims leading/trailing whitespace before returning the body", () => {
    expect(validateThreadBody("  hello world  ")).toEqual({ ok: true, body: "hello world" });
  });

  it("accepts the minimum boundary length", () => {
    const body = "a".repeat(THREAD_BODY_MIN_LENGTH);
    expect(validateThreadBody(body)).toEqual({ ok: true, body });
  });

  it("rejects one character below the minimum boundary", () => {
    const body = "a".repeat(THREAD_BODY_MIN_LENGTH - 1);
    expect(validateThreadBody(body)).toEqual({ ok: false, error: "invalid_input" });
  });

  it("accepts the maximum boundary length", () => {
    const body = "a".repeat(THREAD_BODY_MAX_LENGTH);
    expect(validateThreadBody(body)).toEqual({ ok: true, body });
  });

  it("rejects one character above the maximum boundary", () => {
    const body = "a".repeat(THREAD_BODY_MAX_LENGTH + 1);
    expect(validateThreadBody(body)).toEqual({ ok: false, error: "invalid_input" });
  });

  it("does not truncate an over-length value", () => {
    const body = "a".repeat(THREAD_BODY_MAX_LENGTH + 50);
    expect(validateThreadBody(body).ok).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(validateThreadBody("")).toEqual({ ok: false, error: "invalid_input" });
  });

  it("rejects whitespace-only input", () => {
    expect(validateThreadBody("   \n\t  ")).toEqual({ ok: false, error: "invalid_input" });
  });

  it("rejects non-string input, never throwing", () => {
    expect(validateThreadBody(undefined)).toEqual({ ok: false, error: "invalid_input" });
    expect(validateThreadBody(null)).toEqual({ ok: false, error: "invalid_input" });
    expect(validateThreadBody(42)).toEqual({ ok: false, error: "invalid_input" });
    expect(validateThreadBody(["a valid looking string"])).toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(() => validateThreadBody(Symbol("x"))).not.toThrow();
  });
});

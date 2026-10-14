import { describe, expect, it } from "vitest";
import { normalizeDisplayName } from "../../profiles/domain/display-name";
import { GOAL_TITLE_MAX, GOAL_TITLE_MIN } from "./goal-constants";
import { normalizeGoalTitle } from "./goal-title";

function accepted(input: unknown): string {
  const result = normalizeGoalTitle(input);
  if (!result.ok) {
    throw new Error(`expected ${JSON.stringify(input)} to be accepted`);
  }
  return result.title;
}

describe("normalizeGoalTitle", () => {
  it("exposes the 1–100 code point bounds", () => {
    expect(GOAL_TITLE_MIN).toBe(1);
    expect(GOAL_TITLE_MAX).toBe(100);
  });

  it("accepts a simple title unchanged", () => {
    expect(accepted("Lære Rust")).toBe("Lære Rust");
  });

  it("trims leading and trailing whitespace", () => {
    expect(accepted("  Lære Rust \n")).toBe("Lære Rust");
  });

  it("collapses repeated inner spaces to one", () => {
    expect(accepted("Lære    Rust")).toBe("Lære Rust");
    expect(accepted("Lære  Rust")).toBe("Lære Rust");
  });

  it("normalises to NFC", () => {
    const decomposed = "Bålle"; // a + combining ring
    expect(accepted(decomposed)).toBe("Bålle");
  });

  it("accepts exactly 1 code point", () => {
    expect(accepted("a")).toBe("a");
  });

  it("accepts exactly 100 code points and rejects 101", () => {
    expect(normalizeGoalTitle("a".repeat(100)).ok).toBe(true);
    expect(normalizeGoalTitle("a".repeat(101)).ok).toBe(false);
  });

  it("counts supplementary-plane characters as one code point", () => {
    const hundred = "\u{1D4D0}".repeat(100); // 200 UTF-16 units, 100 code points
    expect(normalizeGoalTitle(hundred).ok).toBe(true);
    expect(normalizeGoalTitle(`${hundred}\u{1D4D0}`).ok).toBe(false);
    expect(accepted("Mål 🚀")).toBe("Mål 🚀");
  });

  it("accepts letters of other scripts and digits", () => {
    expect(accepted("学習")).toBe("学習");
    expect(accepted("123")).toBe("123");
    expect(accepted("٣٤")).toBe("٣٤");
  });

  it.each([["..."], ["🚀🚀"], ["- _ !"]])("rejects %j (no letter or digit)", (input) => {
    expect(normalizeGoalTitle(input).ok).toBe(false);
  });

  it.each([
    ["control", "a\u0007b"],
    ["inner newline", "a\nb"],
    ["inner tab", "a\tb"],
    ["format (zero width space)", "a​b"],
    ["format (bidi override)", "a‮b"],
    ["private use", "ab"],
    ["line separator", "a b"],
    ["paragraph separator", "a b"],
    ["lone surrogate", "a\ud800b"],
  ])("rejects a %s character", (_name, input) => {
    expect(normalizeGoalTitle(input).ok).toBe(false);
  });

  it("treats NBSP and ideographic space as collapsible whitespace", () => {
    expect(accepted("Lære Rust")).toBe("Lære Rust");
    expect(accepted("　Lære　　Rust ")).toBe("Lære Rust");
    expect(accepted("Lære  　  Rust")).toBe("Lære Rust");
  });

  it("rejects empty and whitespace-only input", () => {
    expect(normalizeGoalTitle("").ok).toBe(false);
    expect(normalizeGoalTitle("   \n ").ok).toBe(false);
  });

  it.each([[undefined], [null], [42], [{}], [["a"]]])("rejects non-string %j", (input) => {
    expect(normalizeGoalTitle(input).ok).toBe(false);
  });

  it("does not interpret HTML or Markdown (inert text)", () => {
    expect(accepted("<b>a</b> **x**")).toBe("<b>a</b> **x**");
  });

  it("returns no content-bearing reason on failure", () => {
    expect(normalizeGoalTitle("\u0007secret")).toEqual({ ok: false });
  });

  describe("parity with normalizeDisplayName (differs only in length bounds)", () => {
    const fixtures = [
      "Anna Berg",
      "  Anna  ",
      "Anna    Berg",
      "Bålle",
      "a\nb",
      "a\tb",
      "a​b",
      "ab",
      "a b",
      "a\ud800b",
      "...",
      "🚀🚀",
      "学習",
      "٣٤",
      "ab",
      "",
      "   ",
      "\u{1D4D0}\u{1D4D0}",
    ];

    it.each(fixtures)("agrees on %j", (input) => {
      const goal = normalizeGoalTitle(input);
      const display = normalizeDisplayName(input);
      // Only the length lower bound differs (1 vs 2): single-code-point values.
      if (Array.from(input.normalize("NFC").trim()).length === 1) {
        return;
      }
      expect(goal.ok).toBe(display.ok);
      if (goal.ok && display.ok) {
        expect(goal.title).toBe(display.displayName);
      }
    });
  });
});

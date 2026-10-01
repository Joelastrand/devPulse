import { describe, expect, it } from "vitest";
import { DISPLAY_NAME_MAX_LENGTH, DISPLAY_NAME_MIN_LENGTH, normalizeDisplayName } from "./display-name";

function accepted(input: unknown): string {
  const result = normalizeDisplayName(input);
  if (!result.ok) {
    throw new Error(`expected ${JSON.stringify(input)} to be accepted`);
  }
  return result.displayName;
}

describe("normalizeDisplayName", () => {
  it("exposes the 2–50 code point bounds from the spec", () => {
    expect(DISPLAY_NAME_MIN_LENGTH).toBe(2);
    expect(DISPLAY_NAME_MAX_LENGTH).toBe(50);
  });

  it("accepts an ordinary name unchanged", () => {
    expect(accepted("Anna Berg")).toBe("Anna Berg");
  });

  it("trims leading and trailing whitespace", () => {
    expect(accepted("  Anna  ")).toBe("Anna");
    expect(accepted("\tAnna\n")).toBe("Anna");
  });

  it("collapses every internal run of whitespace to one space", () => {
    expect(accepted("Anna    Berg")).toBe("Anna Berg");
    expect(accepted("Anna    Berg")).toBe("Anna Berg");
  });

  it("normalises to NFC so canonically-equivalent input is stored identically", () => {
    const nfc = "Zoë";
    const nfd = "Zoë";
    expect(accepted(nfd)).toBe(nfc);
    expect(accepted(nfc)).toBe(nfc);
  });

  it("accepts non-Latin scripts, combining marks, apostrophes and hyphens", () => {
    expect(accepted("Åsa-Märta O'Neil")).toBe("Åsa-Märta O'Neil");
    expect(accepted("李小龍")).toBe("李小龍");
    expect(accepted("Ólafur Þór")).toBe("Ólafur Þór");
    expect(accepted("محمد")).toBe("محمد");
  });

  it("accepts a name with a leading emoji as long as it has a letter", () => {
    expect(accepted("🙂 Anna")).toBe("🙂 Anna");
  });

  describe("length is counted in Unicode code points, not UTF-16 units", () => {
    it("rejects a single character", () => {
      expect(normalizeDisplayName("A").ok).toBe(false);
    });

    it("accepts exactly 2 code points", () => {
      expect(accepted("Al")).toBe("Al");
    });

    it("accepts exactly 50 code points and rejects 51", () => {
      expect(accepted("a".repeat(50))).toHaveLength(50);
      expect(normalizeDisplayName("a".repeat(51)).ok).toBe(false);
    });

    it("counts an astral code point as one, so 50 astral characters are accepted", () => {
      const astral = "\u{1d538}"; // MATHEMATICAL DOUBLE-STRUCK CAPITAL A (a letter, 2 UTF-16 units)
      const fifty = astral.repeat(50);
      expect(fifty.length).toBe(100);
      expect(accepted(fifty)).toBe(fifty);
      expect(normalizeDisplayName(astral.repeat(51)).ok).toBe(false);
    });

    it("counts an astral code point as one, so a single astral character is too short", () => {
      expect(normalizeDisplayName("\u{1d538}").ok).toBe(false);
    });
  });

  describe("rejects", () => {
    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a number", 42],
      ["an object", { displayName: "Anna" }],
      ["an array", ["Anna"]],
    ])("non-string input (%s)", (_label, input) => {
      expect(normalizeDisplayName(input).ok).toBe(false);
    });

    it.each([
      ["empty", ""],
      ["spaces only", "    "],
      ["tab/newline only", "\t\n"],
      ["no letter or number (punctuation)", "!!"],
      ["no letter or number (emoji)", "🙂🙂"],
    ])("an empty or non-name value (%s)", (_label, input) => {
      expect(normalizeDisplayName(input).ok).toBe(false);
    });

    it.each([
      ["an inner newline", "Anna\nBerg"],
      ["an inner tab", "Anna\tBerg"],
      ["a zero-width space", "An​na"],
      ["a right-to-left override", "Anna‮Berg"],
      ["a bidirectional isolate", "Anna⁦Berg"],
      ["a line separator", "Anna Berg"],
      ["a paragraph separator", "Anna Berg"],
      ["a NUL control character", "Anna\u0000Berg"],
      ["a private-use code point", "AnnaBerg"],
      ["a lone surrogate", "Anna\ud800Berg"],
    ])("a name containing %s", (_label, input) => {
      expect(normalizeDisplayName(input).ok).toBe(false);
    });

    it("does not reject on length alone before normalising (length is measured after trim/collapse)", () => {
      expect(accepted(`   ${"a".repeat(50)}   `)).toBe("a".repeat(50));
    });
  });
});

import { describe, expect, it } from "vitest";
import { CONVERSATION_ID_PATTERN, isConversationId } from "./conversation-id";

describe("isConversationId accepts the ASCII grammar (AD-3)", () => {
  it.each([
    ["a single letter", "x"],
    ["a single digit", "7"],
    ["alphanumeric", "abc123XYZ"],
    ["a single underscore", "_"],
    ["a single hyphen", "-"],
    ["an internal single underscore", "a_b"],
    ["an internal single hyphen", "a-b"],
    ["a leading single underscore", "_ab"],
    ["a trailing single underscore", "ab_"],
    ["a leading single hyphen", "-ab"],
    ["a trailing single hyphen", "ab-"],
    ["exactly 128 characters", "a".repeat(128)],
    ["a typical Firestore auto id", "Yz8kQm2LxP0bVnRt4sHe"],
  ])("accepts %s", (_label, value) => {
    expect(isConversationId(value)).toBe(true);
  });
});

describe("isConversationId rejects everything else (AD-3)", () => {
  it.each([
    ["the empty string", ""],
    ["a double underscore prefix", "__x"],
    ["a double underscore suffix", "x__"],
    ["a double underscore inside", "x__y"],
    ["a reserved-looking id", "__x__"],
    ["129 characters", "a".repeat(129)],
    ["a dot", "."],
    ["a double dot", ".."],
    ["a dot inside", "a.b"],
    ["a forward slash", "a/b"],
    ["a backslash", "a\\b"],
    ["a space", "a b"],
    ["a leading space", " ab"],
    ["a trailing space", "ab "],
    ["a tab", "a\tb"],
    ["a newline", "ab\n"],
    ["a percent sign (URL encoding)", "a%2Fb"],
    ["a query or fragment marker", "ab?x"],
    ["a hash", "ab#x"],
    ["a colon", "ab:x"],
    ["a plus sign", "a+b"],
    ["an at sign", "a@b"],
    ["a NUL character", "ab\u0000"],
    ["an accented letter (outside ASCII)", "ü"],
    ["a full-width letter", "ａ"],
    ["an emoji", "\u{1F600}"],
  ])("rejects %s", (_label, value) => {
    expect(isConversationId(value)).toBe(false);
  });

  it("rejects non-strings without throwing", () => {
    for (const value of [undefined, null, 1, {}, ["a"]]) {
      expect(isConversationId(value)).toBe(false);
    }
  });

  it("never repairs an invalid id into a valid one", () => {
    // Validation must not trim, lowercase or strip characters: the id is either valid as given or rejected.
    expect(isConversationId(" abc ")).toBe(false);
    expect(isConversationId("a__b".replace("__", "_"))).toBe(true);
  });

  it("keeps the pattern free of path separators and dots", () => {
    expect(CONVERSATION_ID_PATTERN.source).not.toMatch(/[./]/);
  });
});

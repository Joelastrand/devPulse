import { describe, expect, it } from "vitest";
import { normalizeNextStep, normalizeNextSteps, normalizeNote, normalizeTitle, utf8ByteLength } from "./text-rules";

describe("normalizeTitle (BR-39)", () => {
  it("applies NFC before counting", () => {
    // "e" + combining acute is two code points before NFC and one after.
    expect(normalizeTitle("Café")).toEqual({ ok: true, text: "Café" });
  });

  it("trims before the caps are applied", () => {
    expect(normalizeTitle("   " + "a".repeat(100) + "   ")).toEqual({ ok: true, text: "a".repeat(100) });
  });

  it("keeps ordinary internal spaces and Norwegian letters", () => {
    expect(normalizeTitle("Løpe ruting ærlig")).toEqual({ ok: true, text: "Løpe ruting ærlig" });
  });

  it("enforces 1 and 100 code points at the boundary", () => {
    expect(normalizeTitle("a")).toMatchObject({ ok: true });
    expect(normalizeTitle("a".repeat(100))).toMatchObject({ ok: true });
    expect(normalizeTitle("a".repeat(101))).toEqual({ ok: false });
    expect(normalizeTitle("   ")).toEqual({ ok: false });
    expect(normalizeTitle("")).toEqual({ ok: false });
  });

  it("counts code points, not UTF-16 units", () => {
    // Each emoji is one code point but two UTF-16 units: 100 of them fit the code-point cap.
    const hundredEmoji = "\u{1F600}".repeat(100);
    expect(hundredEmoji.length).toBe(200);
    expect(normalizeTitle(hundredEmoji)).toMatchObject({ ok: true });
    expect(normalizeTitle(hundredEmoji + "\u{1F600}")).toEqual({ ok: false });
  });

  it("enforces the 400-byte cap at the exact boundary", () => {
    // 100 four-byte code points = 400 bytes: exactly at the byte cap, accepted.
    const fourByte = "\u{1F600}".repeat(100);
    expect(utf8ByteLength(fourByte)).toBe(400);
    expect(normalizeTitle(fourByte)).toMatchObject({ ok: true });
  });

  it("uses the byte cap as a bound on the code-point cap, not as a separate limit", () => {
    // 100 code points is at most 400 bytes (4 bytes per code point), so the byte cap cannot fire on its
    // own for a title. 100 three-byte code points is 300 bytes and is accepted.
    expect(utf8ByteLength("€".repeat(100))).toBe(300);
    expect(normalizeTitle("€".repeat(100))).toMatchObject({ ok: true });
  });

  it.each([
    ["a line feed", "a\nb"],
    ["a tab", "a\tb"],
    ["a carriage return", "a\rb"],
    ["a NUL character", "a\u0000b"],
    ["a line separator", "a b"],
    ["a paragraph separator", "a b"],
    ["a zero-width space", "a​b"],
    ["a zero-width joiner", "a‍b"],
    ["a bidi override", "a‮b"],
    ["a private-use character", "ab"],
  ])("rejects %s", (_label, value) => {
    expect(normalizeTitle(value)).toEqual({ ok: false });
  });

  it("rejects non-strings without throwing", () => {
    for (const value of [undefined, null, 1, {}, ["a"]]) {
      expect(normalizeTitle(value)).toEqual({ ok: false });
    }
  });
});

describe("normalizeNextStep and normalizeNextSteps (BR-18, BR-39)", () => {
  it("enforces 200 code points", () => {
    expect(normalizeNextStep("x".repeat(200))).toMatchObject({ ok: true });
    expect(normalizeNextStep("x".repeat(201))).toEqual({ ok: false });
  });

  it("enforces the 800-byte cap at the exact boundary", () => {
    // 200 four-byte code points = 800 bytes: exactly at the byte cap, accepted. 201 overflows the code-point cap.
    expect(normalizeNextStep("\u{1F600}".repeat(200))).toMatchObject({ ok: true });
    expect(normalizeNextStep("\u{1F600}".repeat(201))).toEqual({ ok: false });
  });

  it("accepts zero to ten items", () => {
    expect(normalizeNextSteps([])).toEqual({ ok: true, items: [] });
    expect(normalizeNextSteps(Array.from({ length: 10 }, (_, i) => `s${i}`))).toMatchObject({ ok: true });
  });

  it("rejects eleven items", () => {
    expect(normalizeNextSteps(Array.from({ length: 11 }, () => "s"))).toEqual({ ok: false });
  });

  it("rejects an empty item rather than dropping it", () => {
    expect(normalizeNextSteps(["ok", "   "])).toEqual({ ok: false });
  });

  it("trims each item", () => {
    expect(normalizeNextSteps(["  ok  "])).toEqual({ ok: true, items: ["ok"] });
  });

  it("rejects non-array input", () => {
    expect(normalizeNextSteps("ok")).toEqual({ ok: false });
    expect(normalizeNextSteps(undefined)).toEqual({ ok: false });
  });
});

describe("normalizeNote (plain-text notes, BR-20, BR-39)", () => {
  it("accepts an empty string, which is the clear value (BR-20)", () => {
    expect(normalizeNote("")).toEqual({ ok: true, text: "" });
  });

  it("does not trim notes, because BR-39 asks for trimming only on titles and next steps", () => {
    expect(normalizeNote("   ")).toEqual({ ok: true, text: "   " });
    expect(normalizeNote("  a  ")).toEqual({ ok: true, text: "  a  " });
  });

  it("applies NFC", () => {
    expect(normalizeNote("Café")).toEqual({ ok: true, text: "Café" });
  });

  it("keeps line breaks and tabs exactly", () => {
    expect(normalizeNote("linje 1\nlinje 2\tx\r\n")).toEqual({ ok: true, text: "linje 1\nlinje 2\tx\r\n" });
  });

  it("rejects other control, format and separator characters", () => {
    for (const value of ["a\u0000b", "a​b", "a b", "a b", "a\u001bb", "a‮b"]) {
      expect(normalizeNote(value)).toEqual({ ok: false });
    }
  });

  it("caps by UTF-8 bytes at exactly 4096", () => {
    expect(normalizeNote("a".repeat(4096))).toMatchObject({ ok: true });
    expect(normalizeNote("a".repeat(4097))).toEqual({ ok: false });
  });

  it("counts four-byte code points toward the byte cap", () => {
    // 1024 four-byte code points = 4096 bytes; one more byte overflows.
    expect(normalizeNote("\u{1F600}".repeat(1024))).toMatchObject({ ok: true });
    expect(normalizeNote("\u{1F600}".repeat(1024) + "a")).toEqual({ ok: false });
  });

  it("rejects null, which is not an empty string", () => {
    expect(normalizeNote(null)).toEqual({ ok: false });
    expect(normalizeNote(undefined)).toEqual({ ok: false });
  });
});

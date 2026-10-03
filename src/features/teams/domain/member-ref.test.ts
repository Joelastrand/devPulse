import { afterEach, describe, expect, it, vi } from "vitest";
import * as nodeCrypto from "node:crypto";
import { generateMemberRef, isMemberRef, memberRefOf, resolveMemberRef } from "./member-ref";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomBytes: vi.fn(actual.randomBytes) };
});

afterEach(() => {
  vi.mocked(nodeCrypto.randomBytes).mockClear();
});

const ALPHABET = /^[0-9a-hjkmnp-tv-z]{26}$/;

describe("generateMemberRef", () => {
  it("produces 26 lowercase Crockford base32 characters", () => {
    expect(generateMemberRef()).toMatch(ALPHABET);
  });

  it("draws exactly 16 bytes (128 bits) from the CSPRNG and encodes them deterministically", () => {
    vi.mocked(nodeCrypto.randomBytes).mockReturnValueOnce(Buffer.alloc(16, 0) as never);
    expect(generateMemberRef()).toBe("0".repeat(26));

    vi.mocked(nodeCrypto.randomBytes).mockReturnValueOnce(Buffer.alloc(16, 0xff) as never);
    // 128 one-bits = 25 full "z" groups + a final group padded with two zero bits.
    expect(generateMemberRef()).toBe(`${"z".repeat(25)}w`);

    expect(nodeCrypto.randomBytes).toHaveBeenLastCalledWith(16);
  });

  it("takes no input, so a ref can never be derived from a uid, e-mail or doc id", () => {
    expect(generateMemberRef.length).toBe(0);
  });

  it("returns a different value on independent calls", () => {
    expect(generateMemberRef()).not.toBe(generateMemberRef());
  });
});

describe("isMemberRef", () => {
  it("accepts a generated ref", () => {
    expect(isMemberRef(generateMemberRef())).toBe(true);
  });

  it.each([
    ["too short", "a".repeat(25)],
    ["too long", "a".repeat(27)],
    ["uppercase", "A".repeat(26)],
    ["excluded Crockford letter i", `${"a".repeat(25)}i`],
    ["excluded Crockford letter u", `${"a".repeat(25)}u`],
    ["punctuation", `${"a".repeat(25)}-`],
    ["empty", ""],
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
    ["an object", {}],
  ])("rejects %s", (_label, value) => {
    expect(isMemberRef(value)).toBe(false);
  });
});

describe("memberRefOf", () => {
  const ref = "0123456789abcdefghjkmnpqrs";

  it("returns the ref of a membership document that has a valid one", () => {
    expect(memberRefOf({ uid: "u", teamId: "t", memberRef: ref })).toBe(ref);
  });

  it("returns null for a legacy membership without a ref (nothing is fabricated)", () => {
    expect(memberRefOf({ uid: "u", teamId: "t" })).toBeNull();
  });

  it("returns null for a malformed ref or non-object input", () => {
    expect(memberRefOf({ memberRef: "short" })).toBeNull();
    expect(memberRefOf({ memberRef: 7 })).toBeNull();
    expect(memberRefOf(null)).toBeNull();
    expect(memberRefOf("x")).toBeNull();
  });
});

describe("resolveMemberRef", () => {
  const refA = "0123456789abcdefghjkmnpqrs";
  const refB = "tvwxyz0123456789abcdefghjk";
  const mine = { uid: "user-1", teamId: "team-1", memberRef: refA };
  const other = { uid: "user-2", teamId: "team-1", memberRef: refB };

  it("returns the single membership of this team carrying the ref", () => {
    expect(resolveMemberRef([mine, other], "team-1", refA)).toBe(mine);
  });

  it("returns null when no membership carries the ref (e.g. removed)", () => {
    expect(resolveMemberRef([other], "team-1", refA)).toBeNull();
  });

  it("is team scoped: a ref held by another team's membership never resolves", () => {
    expect(resolveMemberRef([{ ...mine, teamId: "team-2" }], "team-1", refA)).toBeNull();
  });

  it("fails closed when two memberships carry the same ref", () => {
    expect(resolveMemberRef([mine, { ...other, memberRef: refA }], "team-1", refA)).toBeNull();
  });

  it("fails closed for a malformed requested ref, even if a document stores the same text", () => {
    const legacyOdd = { uid: "user-3", teamId: "team-1", memberRef: "bad" };
    expect(resolveMemberRef([legacyOdd], "team-1", "bad")).toBeNull();
    expect(resolveMemberRef([mine], "team-1", 42)).toBeNull();
  });

  it("ignores legacy memberships without a ref and non-object entries", () => {
    expect(resolveMemberRef([{ uid: "u", teamId: "team-1" }, null, "x", mine], "team-1", refA)).toBe(
      mine,
    );
  });
});

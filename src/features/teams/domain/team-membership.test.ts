import { describe, expect, it } from "vitest";
import {
  extractMemberUid,
  isValidMembershipFor,
  membershipDocId,
} from "./team-membership";

describe("membershipDocId", () => {
  it("builds a deterministic id from uid and teamId", () => {
    expect(membershipDocId("user-1", "team-1")).toBe("user-1__team-1");
  });

  it("produces different ids for different (uid, teamId) pairs", () => {
    expect(membershipDocId("user-1", "team-1")).not.toBe(
      membershipDocId("user-2", "team-1"),
    );
    expect(membershipDocId("user-1", "team-1")).not.toBe(
      membershipDocId("user-1", "team-2"),
    );
  });
});

describe("isValidMembershipFor", () => {
  const expected = { uid: "user-1", teamId: "team-1" };

  it("accepts a document whose uid and teamId match exactly", () => {
    const result = isValidMembershipFor(
      { uid: "user-1", teamId: "team-1", createdVia: "admin_direct", grantedBy: "admin-1" },
      expected,
    );

    expect(result).toBe(true);
  });

  it("rejects a document for a different uid", () => {
    const result = isValidMembershipFor(
      { uid: "someone-else", teamId: "team-1" },
      expected,
    );

    expect(result).toBe(false);
  });

  it("rejects a document for a different teamId", () => {
    const result = isValidMembershipFor(
      { uid: "user-1", teamId: "other-team" },
      expected,
    );

    expect(result).toBe(false);
  });

  it("rejects a nonexistent document (undefined)", () => {
    expect(isValidMembershipFor(undefined, expected)).toBe(false);
  });

  it("rejects null, non-object, and shapeless values without throwing", () => {
    expect(isValidMembershipFor(null, expected)).toBe(false);
    expect(isValidMembershipFor("not an object", expected)).toBe(false);
    expect(isValidMembershipFor(42, expected)).toBe(false);
    expect(isValidMembershipFor({}, expected)).toBe(false);
  });

  it("rejects a document with a non-string uid/teamId (fails closed rather than coercing)", () => {
    expect(
      isValidMembershipFor({ uid: 12345, teamId: "team-1" }, expected),
    ).toBe(false);
  });
});

describe("extractMemberUid", () => {
  it("returns the uid from a well-formed membership document", () => {
    expect(extractMemberUid({ uid: "user-1", teamId: "team-1" })).toBe(
      "user-1",
    );
  });

  it("returns null for a document with a missing uid", () => {
    expect(extractMemberUid({ teamId: "team-1" })).toBeNull();
  });

  it("returns null for a document with a non-string uid", () => {
    expect(extractMemberUid({ uid: 42, teamId: "team-1" })).toBeNull();
  });

  it("returns null for a document with an empty-string uid", () => {
    expect(extractMemberUid({ uid: "", teamId: "team-1" })).toBeNull();
  });

  it("returns null for null/non-object values without throwing", () => {
    expect(extractMemberUid(null)).toBeNull();
    expect(extractMemberUid("not an object")).toBeNull();
    expect(extractMemberUid(undefined)).toBeNull();
  });
});

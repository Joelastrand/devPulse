import { describe, expect, it } from "vitest";
import { effectiveChallengeStatus, isValidChallenge } from "./challenge";

describe("effectiveChallengeStatus", () => {
  it("is 'open' when neither resolvedAt nor archivedAt is set", () => {
    expect(effectiveChallengeStatus({})).toBe("open");
  });

  it("is 'resolved' when resolvedAt is set and archivedAt is not", () => {
    expect(
      effectiveChallengeStatus({ resolvedAt: new Date("2026-06-01T00:00:00.000Z") }),
    ).toBe("resolved");
  });

  it("is 'archived' when archivedAt is set and resolvedAt is not (archived directly from open)", () => {
    expect(
      effectiveChallengeStatus({ archivedAt: new Date("2026-06-01T00:00:00.000Z") }),
    ).toBe("archived");
  });

  it("is 'archived' when both resolvedAt and archivedAt are set — archived takes precedence", () => {
    expect(
      effectiveChallengeStatus({
        resolvedAt: new Date("2026-06-01T00:00:00.000Z"),
        archivedAt: new Date("2026-06-05T00:00:00.000Z"),
      }),
    ).toBe("archived");
  });
});

describe("isValidChallenge", () => {
  const valid = {
    challengeId: "challenge-1",
    teamId: "team-1",
    ciphertext: "ciphertext-base64",
    iv: "iv-base64",
    authTag: "auth-tag-base64",
    keyVersion: "v1",
    submittedAt: new Date("2026-06-01T00:00:00.000Z"),
  };

  it("accepts a well-formed minimal candidate (no resolvedAt/archivedAt)", () => {
    expect(isValidChallenge(valid, { challengeId: "challenge-1" })).toBe(true);
  });

  it("accepts a fully-populated candidate (resolved then archived)", () => {
    const full = {
      ...valid,
      resolvedAt: new Date("2026-06-02T00:00:00.000Z"),
      resolvedBy: "admin-uid-1",
      archivedAt: new Date("2026-06-03T00:00:00.000Z"),
      archivedBy: "admin-uid-2",
    };
    expect(isValidChallenge(full, { challengeId: "challenge-1" })).toBe(true);
  });

  it("rejects a challengeId mismatch", () => {
    expect(isValidChallenge(valid, { challengeId: "some-other-id" })).toBe(false);
  });

  it("rejects a missing/blank/wrong-typed teamId", () => {
    expect(
      isValidChallenge({ ...valid, teamId: undefined }, { challengeId: "challenge-1" }),
    ).toBe(false);
    expect(isValidChallenge({ ...valid, teamId: "" }, { challengeId: "challenge-1" })).toBe(
      false,
    );
    expect(isValidChallenge({ ...valid, teamId: 42 }, { challengeId: "challenge-1" })).toBe(
      false,
    );
  });

  it("rejects a missing/blank ciphertext, iv, or authTag", () => {
    expect(
      isValidChallenge({ ...valid, ciphertext: "" }, { challengeId: "challenge-1" }),
    ).toBe(false);
    expect(
      isValidChallenge({ ...valid, iv: undefined }, { challengeId: "challenge-1" }),
    ).toBe(false);
    expect(
      isValidChallenge({ ...valid, authTag: 123 }, { challengeId: "challenge-1" }),
    ).toBe(false);
  });

  it("rejects a syntactically-valid-but-wrong keyVersion, not just any string", () => {
    expect(
      isValidChallenge({ ...valid, keyVersion: "v2" }, { challengeId: "challenge-1" }),
    ).toBe(false);
    expect(
      isValidChallenge({ ...valid, keyVersion: "" }, { challengeId: "challenge-1" }),
    ).toBe(false);
    expect(
      isValidChallenge({ ...valid, keyVersion: undefined }, { challengeId: "challenge-1" }),
    ).toBe(false);
  });

  it("rejects a missing or invalid submittedAt", () => {
    const withoutSubmittedAt: Record<string, unknown> = { ...valid };
    delete withoutSubmittedAt.submittedAt;
    expect(isValidChallenge(withoutSubmittedAt, { challengeId: "challenge-1" })).toBe(false);
    expect(
      isValidChallenge(
        { ...valid, submittedAt: "2026-06-01T00:00:00.000Z" },
        { challengeId: "challenge-1" },
      ),
    ).toBe(false);
    expect(
      isValidChallenge(
        { ...valid, submittedAt: new Date("not a date") },
        { challengeId: "challenge-1" },
      ),
    ).toBe(false);
  });

  it("rejects resolvedAt set without resolvedBy", () => {
    expect(
      isValidChallenge(
        { ...valid, resolvedAt: new Date("2026-06-02T00:00:00.000Z") },
        { challengeId: "challenge-1" },
      ),
    ).toBe(false);
  });

  it("rejects resolvedBy set without resolvedAt", () => {
    expect(
      isValidChallenge(
        { ...valid, resolvedBy: "admin-uid-1" },
        { challengeId: "challenge-1" },
      ),
    ).toBe(false);
  });

  it("rejects archivedAt set without archivedBy", () => {
    expect(
      isValidChallenge(
        { ...valid, archivedAt: new Date("2026-06-02T00:00:00.000Z") },
        { challengeId: "challenge-1" },
      ),
    ).toBe(false);
  });

  it("rejects archivedBy set without archivedAt", () => {
    expect(
      isValidChallenge(
        { ...valid, archivedBy: "admin-uid-1" },
        { challengeId: "challenge-1" },
      ),
    ).toBe(false);
  });

  it("rejects a malformed resolvedAt/archivedAt even when the paired actor is present", () => {
    expect(
      isValidChallenge(
        { ...valid, resolvedAt: "not a date", resolvedBy: "admin-uid-1" },
        { challengeId: "challenge-1" },
      ),
    ).toBe(false);
    expect(
      isValidChallenge(
        {
          ...valid,
          archivedAt: new Date("2026-06-02T00:00:00.000Z"),
          archivedBy: "",
        },
        { challengeId: "challenge-1" },
      ),
    ).toBe(false);
  });

  it("fails closed on non-object/malformed candidate data, never throwing", () => {
    expect(isValidChallenge(null, { challengeId: "challenge-1" })).toBe(false);
    expect(isValidChallenge(undefined, { challengeId: "challenge-1" })).toBe(false);
    expect(isValidChallenge("not an object", { challengeId: "challenge-1" })).toBe(false);
    expect(isValidChallenge(42, { challengeId: "challenge-1" })).toBe(false);
    expect(isValidChallenge([], { challengeId: "challenge-1" })).toBe(false);
    expect(() => isValidChallenge(Symbol("x"), { challengeId: "challenge-1" })).not.toThrow();
  });

  it("has no submitter identity requirement — a well-formed candidate with no uid/email/name field is valid", () => {
    const record = valid as Record<string, unknown>;
    expect("uid" in record).toBe(false);
    expect("email" in record).toBe(false);
    expect("displayName" in record).toBe(false);
    expect("submittedBy" in record).toBe(false);
    expect(isValidChallenge(valid, { challengeId: "challenge-1" })).toBe(true);
  });

  it("tolerates an extra submitter-shaped field without treating it as required or as invalidating the record", () => {
    const withExtraField = { ...valid, uid: "attacker-uid", submittedBy: "attacker-uid" };
    expect(isValidChallenge(withExtraField, { challengeId: "challenge-1" })).toBe(true);
  });
});

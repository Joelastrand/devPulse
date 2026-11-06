import { describe, expect, it } from "vitest";
import {
  activeCountAfterGrant,
  activeCountAfterRevoke,
  decideGrant,
  decideRevoke,
  parseActiveCount,
  parseSuperadminRecord,
} from "./superadmin-registry";

const ACTIVE = (uid: string) => ({ uid, active: true }) as const;
const REVOKED = (uid: string) => ({ uid, active: false }) as const;

describe("parseSuperadminRecord", () => {
  it("accepts a record whose uid matches its document id", () => {
    expect(parseSuperadminRecord({ uid: "u1", active: true }, "u1")).toEqual({ uid: "u1", active: true });
  });

  it("rejects a uid that does not match the document id", () => {
    expect(parseSuperadminRecord({ uid: "other", active: true }, "u1")).toBeUndefined();
  });

  it("rejects a missing or non-boolean active flag (fails closed)", () => {
    expect(parseSuperadminRecord({ uid: "u1" }, "u1")).toBeUndefined();
    expect(parseSuperadminRecord({ uid: "u1", active: "true" }, "u1")).toBeUndefined();
  });

  it("rejects non-object data and missing documents", () => {
    expect(parseSuperadminRecord(undefined, "u1")).toBeUndefined();
    expect(parseSuperadminRecord("u1", "u1")).toBeUndefined();
    expect(parseSuperadminRecord(null, "u1")).toBeUndefined();
  });
});

describe("parseActiveCount", () => {
  it("treats a missing control document as zero active superadmins", () => {
    expect(parseActiveCount(undefined)).toBe(0);
  });

  it("accepts a non-negative safe integer", () => {
    expect(parseActiveCount({ activeCount: 2 })).toBe(2);
  });

  it("rejects malformed counts so the caller fails closed", () => {
    expect(parseActiveCount({ activeCount: -1 })).toBeUndefined();
    expect(parseActiveCount({ activeCount: 1.5 })).toBeUndefined();
    expect(parseActiveCount({ activeCount: "1" })).toBeUndefined();
    expect(parseActiveCount(null)).toBeUndefined();
  });
});

describe("decideGrant", () => {
  it("lets an active superadmin grant an existing user", () => {
    expect(decideGrant({ actorUid: "a", targetUid: "b", actor: ACTIVE("a"), target: undefined })).toEqual({
      ok: true,
      outcome: "granted",
    });
  });

  it("refuses a grant from a non-superadmin", () => {
    expect(decideGrant({ actorUid: "a", targetUid: "b", actor: undefined, target: undefined })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("refuses a grant from a revoked superadmin (stale role)", () => {
    expect(decideGrant({ actorUid: "a", targetUid: "b", actor: REVOKED("a"), target: undefined })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("refuses self-promotion by a non-superadmin", () => {
    expect(decideGrant({ actorUid: "a", targetUid: "a", actor: undefined, target: undefined })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("treats granting an already-active target as an idempotent success", () => {
    expect(decideGrant({ actorUid: "a", targetUid: "b", actor: ACTIVE("a"), target: ACTIVE("b") })).toEqual({
      ok: true,
      outcome: "already_superadmin",
    });
  });

  it("re-grants a previously revoked target", () => {
    expect(decideGrant({ actorUid: "a", targetUid: "b", actor: ACTIVE("a"), target: REVOKED("b") })).toEqual({
      ok: true,
      outcome: "granted",
    });
  });
});

describe("decideRevoke", () => {
  it("revokes an active target while another active superadmin remains", () => {
    expect(
      decideRevoke({ actorUid: "a", targetUid: "b", actor: ACTIVE("a"), target: ACTIVE("b"), activeCount: 2 }),
    ).toEqual({ ok: true, outcome: "revoked" });
  });

  it("refuses to revoke the last active superadmin", () => {
    expect(
      decideRevoke({ actorUid: "a", targetUid: "a", actor: ACTIVE("a"), target: ACTIVE("a"), activeCount: 1 }),
    ).toEqual({ ok: false, error: "last_superadmin" });
  });

  it("refuses a revocation from a non-superadmin", () => {
    expect(
      decideRevoke({ actorUid: "a", targetUid: "b", actor: undefined, target: ACTIVE("b"), activeCount: 2 }),
    ).toEqual({ ok: false, error: "forbidden" });
  });

  it("refuses to revoke a target that is not an active superadmin", () => {
    expect(
      decideRevoke({ actorUid: "a", targetUid: "b", actor: ACTIVE("a"), target: undefined, activeCount: 2 }),
    ).toEqual({ ok: false, error: "not_superadmin" });
  });
});

describe("active count transitions", () => {
  it("increments on grant and decrements on revoke", () => {
    expect(activeCountAfterGrant(0)).toBe(1);
    expect(activeCountAfterRevoke(2)).toBe(1);
  });
});

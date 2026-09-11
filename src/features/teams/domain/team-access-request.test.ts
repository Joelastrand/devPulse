import { describe, expect, it } from "vitest";
import {
  accessRequestDocId,
  isValidAccessRequestStatus,
  isValidPendingAccessRequestFor,
  isValidPendingAccessRequestForTeam,
  readAccessRequestStatusFor,
} from "./team-access-request";

describe("accessRequestDocId", () => {
  it("builds a deterministic id from uid and teamId", () => {
    expect(accessRequestDocId("user-1", "team-1")).toBe("user-1__team-1");
  });

  it("produces different ids for different (uid, teamId) pairs", () => {
    expect(accessRequestDocId("user-1", "team-1")).not.toBe(
      accessRequestDocId("user-2", "team-1"),
    );
    expect(accessRequestDocId("user-1", "team-1")).not.toBe(
      accessRequestDocId("user-1", "team-2"),
    );
  });
});

describe("isValidAccessRequestStatus", () => {
  it("accepts each defined status", () => {
    expect(isValidAccessRequestStatus("pending")).toBe(true);
    expect(isValidAccessRequestStatus("approved")).toBe(true);
    expect(isValidAccessRequestStatus("rejected")).toBe(true);
  });

  it("rejects an unrecognized or non-string value", () => {
    expect(isValidAccessRequestStatus("expired")).toBe(false);
    expect(isValidAccessRequestStatus(undefined)).toBe(false);
    expect(isValidAccessRequestStatus(null)).toBe(false);
    expect(isValidAccessRequestStatus(42)).toBe(false);
  });
});

describe("isValidPendingAccessRequestFor", () => {
  const expected = { uid: "user-1", teamId: "team-1" };

  it("accepts a pending request matching uid and teamId exactly", () => {
    expect(
      isValidPendingAccessRequestFor(
        { teamId: "team-1", uid: "user-1", status: "pending" },
        expected,
      ),
    ).toBe(true);
  });

  it("rejects a request for a different uid", () => {
    expect(
      isValidPendingAccessRequestFor(
        { teamId: "team-1", uid: "someone-else", status: "pending" },
        expected,
      ),
    ).toBe(false);
  });

  it("rejects a request for a different team", () => {
    expect(
      isValidPendingAccessRequestFor(
        { teamId: "other-team", uid: "user-1", status: "pending" },
        expected,
      ),
    ).toBe(false);
  });

  it("rejects a non-pending status (approved or rejected)", () => {
    expect(
      isValidPendingAccessRequestFor(
        { teamId: "team-1", uid: "user-1", status: "approved" },
        expected,
      ),
    ).toBe(false);
    expect(
      isValidPendingAccessRequestFor(
        { teamId: "team-1", uid: "user-1", status: "rejected" },
        expected,
      ),
    ).toBe(false);
  });

  it("rejects a nonexistent document (undefined) and non-object values without throwing", () => {
    expect(isValidPendingAccessRequestFor(undefined, expected)).toBe(false);
    expect(isValidPendingAccessRequestFor(null, expected)).toBe(false);
    expect(isValidPendingAccessRequestFor("not an object", expected)).toBe(false);
  });
});

describe("readAccessRequestStatusFor", () => {
  const expected = { uid: "user-1", teamId: "team-1" };

  it("returns the status for a matching document", () => {
    expect(
      readAccessRequestStatusFor(
        { teamId: "team-1", uid: "user-1", status: "rejected" },
        expected,
      ),
    ).toBe("rejected");
  });

  it("returns null for a missing document", () => {
    expect(readAccessRequestStatusFor(undefined, expected)).toBeNull();
  });

  it("returns null for a document belonging to a different uid or team", () => {
    expect(
      readAccessRequestStatusFor(
        { teamId: "other-team", uid: "user-1", status: "pending" },
        expected,
      ),
    ).toBeNull();
    expect(
      readAccessRequestStatusFor(
        { teamId: "team-1", uid: "someone-else", status: "pending" },
        expected,
      ),
    ).toBeNull();
  });

  it("returns null for a malformed/unrecognized status (fails closed)", () => {
    expect(
      readAccessRequestStatusFor(
        { teamId: "team-1", uid: "user-1", status: "expired" },
        expected,
      ),
    ).toBeNull();
  });
});

describe("isValidPendingAccessRequestForTeam", () => {
  it("accepts a well-formed pending request for the given team", () => {
    expect(
      isValidPendingAccessRequestForTeam(
        { teamId: "team-1", uid: "user-1", status: "pending" },
        "team-1",
      ),
    ).toBe(true);
  });

  it("rejects a request for a different team", () => {
    expect(
      isValidPendingAccessRequestForTeam(
        { teamId: "other-team", uid: "user-1", status: "pending" },
        "team-1",
      ),
    ).toBe(false);
  });

  it("rejects a non-pending request", () => {
    expect(
      isValidPendingAccessRequestForTeam(
        { teamId: "team-1", uid: "user-1", status: "approved" },
        "team-1",
      ),
    ).toBe(false);
  });

  it("rejects a malformed document without throwing", () => {
    expect(isValidPendingAccessRequestForTeam(undefined, "team-1")).toBe(false);
    expect(isValidPendingAccessRequestForTeam(null, "team-1")).toBe(false);
    expect(isValidPendingAccessRequestForTeam({}, "team-1")).toBe(false);
  });
});

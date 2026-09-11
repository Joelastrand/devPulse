import { describe, expect, it } from "vitest";
import {
  invitationDocId,
  isValidInvitationStatus,
  isValidPendingInvitationFor,
  isValidPendingInvitationForTeam,
  readInvitationStatusFor,
} from "./team-invitation";

describe("invitationDocId", () => {
  it("builds a deterministic id from teamId and normalized email", () => {
    expect(invitationDocId("team-1", "dev@example.com")).toBe(
      "team-1__dev@example.com",
    );
  });

  it("produces different ids for different (teamId, email) pairs", () => {
    expect(invitationDocId("team-1", "dev@example.com")).not.toBe(
      invitationDocId("team-2", "dev@example.com"),
    );
    expect(invitationDocId("team-1", "dev@example.com")).not.toBe(
      invitationDocId("team-1", "other@example.com"),
    );
  });
});

describe("isValidInvitationStatus", () => {
  it("accepts each defined status", () => {
    expect(isValidInvitationStatus("pending")).toBe(true);
    expect(isValidInvitationStatus("accepted")).toBe(true);
    expect(isValidInvitationStatus("canceled")).toBe(true);
  });

  it("rejects an unrecognized or non-string value", () => {
    expect(isValidInvitationStatus("expired")).toBe(false);
    expect(isValidInvitationStatus(undefined)).toBe(false);
    expect(isValidInvitationStatus(null)).toBe(false);
    expect(isValidInvitationStatus(42)).toBe(false);
  });
});

describe("isValidPendingInvitationFor", () => {
  const expected = { teamId: "team-1", email: "dev@example.com" };

  it("accepts a pending invitation matching team and email exactly", () => {
    expect(
      isValidPendingInvitationFor(
        { teamId: "team-1", email: "dev@example.com", status: "pending", invitedBy: "admin-1" },
        expected,
      ),
    ).toBe(true);
  });

  it("rejects a document for a different team", () => {
    expect(
      isValidPendingInvitationFor(
        { teamId: "other-team", email: "dev@example.com", status: "pending", invitedBy: "admin-1" },
        expected,
      ),
    ).toBe(false);
  });

  it("rejects a document for a different email", () => {
    expect(
      isValidPendingInvitationFor(
        { teamId: "team-1", email: "someone-else@example.com", status: "pending", invitedBy: "admin-1" },
        expected,
      ),
    ).toBe(false);
  });

  it("rejects a non-pending status (accepted or canceled)", () => {
    expect(
      isValidPendingInvitationFor(
        { teamId: "team-1", email: "dev@example.com", status: "accepted", invitedBy: "admin-1" },
        expected,
      ),
    ).toBe(false);
    expect(
      isValidPendingInvitationFor(
        { teamId: "team-1", email: "dev@example.com", status: "canceled", invitedBy: "admin-1" },
        expected,
      ),
    ).toBe(false);
  });

  it("rejects a document with a missing/non-string invitedBy", () => {
    expect(
      isValidPendingInvitationFor(
        { teamId: "team-1", email: "dev@example.com", status: "pending" },
        expected,
      ),
    ).toBe(false);
    expect(
      isValidPendingInvitationFor(
        { teamId: "team-1", email: "dev@example.com", status: "pending", invitedBy: 42 },
        expected,
      ),
    ).toBe(false);
  });

  it("rejects a nonexistent document (undefined) and non-object values without throwing", () => {
    expect(isValidPendingInvitationFor(undefined, expected)).toBe(false);
    expect(isValidPendingInvitationFor(null, expected)).toBe(false);
    expect(isValidPendingInvitationFor("not an object", expected)).toBe(false);
  });
});

describe("readInvitationStatusFor", () => {
  const expected = { teamId: "team-1", email: "dev@example.com" };

  it("returns the status for a matching document", () => {
    expect(
      readInvitationStatusFor(
        { teamId: "team-1", email: "dev@example.com", status: "canceled" },
        expected,
      ),
    ).toBe("canceled");
  });

  it("returns null for a missing document", () => {
    expect(readInvitationStatusFor(undefined, expected)).toBeNull();
  });

  it("returns null for a document belonging to a different team or email", () => {
    expect(
      readInvitationStatusFor(
        { teamId: "other-team", email: "dev@example.com", status: "pending" },
        expected,
      ),
    ).toBeNull();
    expect(
      readInvitationStatusFor(
        { teamId: "team-1", email: "someone-else@example.com", status: "pending" },
        expected,
      ),
    ).toBeNull();
  });

  it("returns null for a malformed/unrecognized status (fails closed)", () => {
    expect(
      readInvitationStatusFor(
        { teamId: "team-1", email: "dev@example.com", status: "expired" },
        expected,
      ),
    ).toBeNull();
  });
});

describe("isValidPendingInvitationForTeam", () => {
  it("accepts a well-formed pending invitation for the given team", () => {
    expect(
      isValidPendingInvitationForTeam(
        { teamId: "team-1", email: "dev@example.com", status: "pending", invitedBy: "admin-1" },
        "team-1",
      ),
    ).toBe(true);
  });

  it("rejects an invitation for a different team", () => {
    expect(
      isValidPendingInvitationForTeam(
        { teamId: "other-team", email: "dev@example.com", status: "pending", invitedBy: "admin-1" },
        "team-1",
      ),
    ).toBe(false);
  });

  it("rejects a non-pending invitation", () => {
    expect(
      isValidPendingInvitationForTeam(
        { teamId: "team-1", email: "dev@example.com", status: "accepted", invitedBy: "admin-1" },
        "team-1",
      ),
    ).toBe(false);
  });

  it("rejects a malformed document without throwing", () => {
    expect(isValidPendingInvitationForTeam(undefined, "team-1")).toBe(false);
    expect(isValidPendingInvitationForTeam(null, "team-1")).toBe(false);
    expect(isValidPendingInvitationForTeam({}, "team-1")).toBe(false);
  });
});

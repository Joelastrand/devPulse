import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { TeamInvitationsCollection } from "./list-team-invitations";
import { listTeamInvitations } from "./list-team-invitations";

const ADMIN_EMAIL = "admin@example.com";
const CREATED_AT = new Date("2026-09-01T00:00:00Z");

function verifiedIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: "admin-1", email: ADMIN_EMAIL, emailVerified: true, ...overrides };
}

function verifyTokenReturning(identity: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: identity.uid,
    email: identity.email,
    email_verified: identity.emailVerified,
  });
}

function fakeCollection(rawDocs: unknown[]): TeamInvitationsCollection {
  return { listRawForTeam: vi.fn().mockResolvedValue(rawDocs) };
}

const baseDeps = {
  verifyToken: verifyTokenReturning(verifiedIdentity()),
  allowList: [ADMIN_EMAIL],
};

describe("listTeamInvitations", () => {
  it("returns each pending invitation's email, invitedBy, and createdAt", async () => {
    const collection = fakeCollection([
      {
        teamId: "team-1",
        email: "dev1@example.com",
        status: "pending",
        invitedBy: "admin-1",
        createdAt: CREATED_AT,
      },
      {
        teamId: "team-1",
        email: "dev2@example.com",
        status: "pending",
        invitedBy: "admin-1",
        createdAt: CREATED_AT,
      },
    ]);

    const result = await listTeamInvitations("token", "team-1", { ...baseDeps, collection });

    expect(result).toEqual({
      ok: true,
      invitations: [
        { email: "dev1@example.com", invitedBy: "admin-1", createdAt: CREATED_AT },
        { email: "dev2@example.com", invitedBy: "admin-1", createdAt: CREATED_AT },
      ],
    });
  });

  it("excludes accepted and canceled invitations", async () => {
    const collection = fakeCollection([
      {
        teamId: "team-1",
        email: "pending@example.com",
        status: "pending",
        invitedBy: "admin-1",
        createdAt: CREATED_AT,
      },
      {
        teamId: "team-1",
        email: "accepted@example.com",
        status: "accepted",
        invitedBy: "admin-1",
        createdAt: CREATED_AT,
      },
      {
        teamId: "team-1",
        email: "canceled@example.com",
        status: "canceled",
        invitedBy: "admin-1",
        createdAt: CREATED_AT,
      },
    ]);

    const result = await listTeamInvitations("token", "team-1", { ...baseDeps, collection });

    expect(result).toEqual({
      ok: true,
      invitations: [{ email: "pending@example.com", invitedBy: "admin-1", createdAt: CREATED_AT }],
    });
  });

  it("excludes a malformed document rather than crashing", async () => {
    const collection = fakeCollection([
      {
        teamId: "team-1",
        email: "valid@example.com",
        status: "pending",
        invitedBy: "admin-1",
        createdAt: CREATED_AT,
      },
      { teamId: "team-1", status: "pending" }, // missing email/invitedBy
      null,
    ]);

    const result = await listTeamInvitations("token", "team-1", { ...baseDeps, collection });

    expect(result).toEqual({
      ok: true,
      invitations: [{ email: "valid@example.com", invitedBy: "admin-1", createdAt: CREATED_AT }],
    });
  });

  it("rejects an unauthenticated caller and attempts no read", async () => {
    const collection = fakeCollection([]);

    const result = await listTeamInvitations("bad-token", "team-1", {
      verifyToken: vi.fn().mockRejectedValue(new Error("bad token")),
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(collection.listRawForTeam).not.toHaveBeenCalled();
  });

  it("rejects a non-admin caller and attempts no read", async () => {
    const collection = fakeCollection([]);

    const result = await listTeamInvitations("token", "team-1", {
      verifyToken: verifyTokenReturning(verifiedIdentity({ email: "dev@example.com" })),
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.listRawForTeam).not.toHaveBeenCalled();
  });

  it("reports failure, not a partial list, when the Firestore read fails", async () => {
    const collection: TeamInvitationsCollection = {
      listRawForTeam: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await listTeamInvitations("token", "team-1", { ...baseDeps, collection });

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("never includes the admin allow-list in the returned result", async () => {
    const allowList = [ADMIN_EMAIL, "other-admin@example.com"];
    const collection = fakeCollection([]);

    const result = await listTeamInvitations("token", "team-1", {
      verifyToken: verifyTokenReturning(verifiedIdentity()),
      allowList,
      collection,
    });

    expect(JSON.stringify(result)).not.toContain("other-admin@example.com");
  });
});

import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { TeamInvitationsCollection } from "./list-team-invitations";
import { listTeamInvitations } from "./list-team-invitations";
import { verifierFor } from "../../../../test/auth-fixtures";

const ADMIN_EMAIL = "admin@nve.no";
const ADMIN_UID = "admin-1";
const isAdminUid = async (uid: string): Promise<boolean> => uid === ADMIN_UID;
const CREATED_AT = new Date("2026-09-01T00:00:00Z");

function verifiedIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: "admin-1", email: ADMIN_EMAIL, emailVerified: true, ...overrides };
}

function verifyTokenReturning(identity: VerifiedIdentity) {
  return verifierFor({ uid: identity.uid, email: identity.email, emailVerified: identity.emailVerified });
}

function fakeCollection(rawDocs: unknown[]): TeamInvitationsCollection {
  return { listRawForTeam: vi.fn().mockResolvedValue(rawDocs) };
}

const baseDeps = {
  verifyToken: verifyTokenReturning(verifiedIdentity()),
  isSuperadmin: isAdminUid,
};

describe("listTeamInvitations", () => {
  it("returns each pending invitation's email, invitedBy, and createdAt", async () => {
    const collection = fakeCollection([
      {
        teamId: "team-1",
        email: "dev1@nve.no",
        status: "pending",
        invitedBy: "admin-1",
        createdAt: CREATED_AT,
      },
      {
        teamId: "team-1",
        email: "dev2@nve.no",
        status: "pending",
        invitedBy: "admin-1",
        createdAt: CREATED_AT,
      },
    ]);

    const result = await listTeamInvitations("token", "team-1", { ...baseDeps, collection });

    expect(result).toEqual({
      ok: true,
      invitations: [
        { email: "dev1@nve.no", invitedBy: "admin-1", createdAt: CREATED_AT },
        { email: "dev2@nve.no", invitedBy: "admin-1", createdAt: CREATED_AT },
      ],
    });
  });

  it("excludes accepted and canceled invitations", async () => {
    const collection = fakeCollection([
      {
        teamId: "team-1",
        email: "pending@nve.no",
        status: "pending",
        invitedBy: "admin-1",
        createdAt: CREATED_AT,
      },
      {
        teamId: "team-1",
        email: "accepted@nve.no",
        status: "accepted",
        invitedBy: "admin-1",
        createdAt: CREATED_AT,
      },
      {
        teamId: "team-1",
        email: "canceled@nve.no",
        status: "canceled",
        invitedBy: "admin-1",
        createdAt: CREATED_AT,
      },
    ]);

    const result = await listTeamInvitations("token", "team-1", { ...baseDeps, collection });

    expect(result).toEqual({
      ok: true,
      invitations: [{ email: "pending@nve.no", invitedBy: "admin-1", createdAt: CREATED_AT }],
    });
  });

  it("excludes a malformed document rather than crashing", async () => {
    const collection = fakeCollection([
      {
        teamId: "team-1",
        email: "valid@nve.no",
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
      invitations: [{ email: "valid@nve.no", invitedBy: "admin-1", createdAt: CREATED_AT }],
    });
  });

  it("rejects an unauthenticated caller and attempts no read", async () => {
    const collection = fakeCollection([]);

    const result = await listTeamInvitations("bad-token", "team-1", {
      verifyToken: vi.fn().mockRejectedValue(new Error("bad token")),
      isSuperadmin: isAdminUid,
      collection,
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(collection.listRawForTeam).not.toHaveBeenCalled();
  });

  it("rejects a non-admin caller and attempts no read", async () => {
    const collection = fakeCollection([]);

    const result = await listTeamInvitations("token", "team-1", {
      verifyToken: verifyTokenReturning(verifiedIdentity({ uid: "non-admin-1", email: "dev@nve.no" })),
      isSuperadmin: isAdminUid,
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

  it("never includes superadmin identifiers in the returned result", async () => {
    const isSuperadmin = isAdminUid;
    const collection = fakeCollection([]);

    const result = await listTeamInvitations("token", "team-1", {
      verifyToken: verifyTokenReturning(verifiedIdentity()),
      isSuperadmin,
      collection,
    });

    expect(JSON.stringify(result)).not.toContain("other-admin@nve.no");
  });
});

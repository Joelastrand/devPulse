import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { TeamMembersCollection } from "./list-team-members";
import { listTeamMembers } from "./list-team-members";

const ADMIN_EMAIL = "admin@example.com";

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

function fakeCollection(rawDocs: unknown[]): TeamMembersCollection {
  return { listRawForTeam: vi.fn().mockResolvedValue(rawDocs) };
}

function fakeGetUser(emails: Record<string, string>) {
  return vi.fn(async (uid: string) => {
    if (!(uid in emails)) {
      throw new Error("no such user");
    }
    return { email: emails[uid] };
  });
}

describe("listTeamMembers", () => {
  it("returns each member's uid with email resolved live from Firebase Auth", async () => {
    const verifyToken = verifyTokenReturning(verifiedIdentity());
    const collection = fakeCollection([
      { uid: "user-1", teamId: "team-1" },
      { uid: "user-2", teamId: "team-1" },
    ]);
    const getUser = fakeGetUser({ "user-1": "one@example.com", "user-2": "two@example.com" });

    const result = await listTeamMembers("token", "team-1", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
      getUser,
    });

    expect(result).toEqual({
      ok: true,
      members: [
        { uid: "user-1", email: "one@example.com" },
        { uid: "user-2", email: "two@example.com" },
      ],
    });
  });

  it("excludes a document with a malformed/missing uid rather than crashing", async () => {
    const verifyToken = verifyTokenReturning(verifiedIdentity());
    const collection = fakeCollection([
      { uid: "user-1", teamId: "team-1" },
      { teamId: "team-1" }, // missing uid
      { uid: 12345, teamId: "team-1" }, // non-string uid
    ]);
    const getUser = fakeGetUser({ "user-1": "one@example.com" });

    const result = await listTeamMembers("token", "team-1", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
      getUser,
    });

    expect(result).toEqual({
      ok: true,
      members: [{ uid: "user-1", email: "one@example.com" }],
    });
  });

  it("excludes a member whose uid no longer resolves to a live Firebase account", async () => {
    const verifyToken = verifyTokenReturning(verifiedIdentity());
    const collection = fakeCollection([
      { uid: "user-1", teamId: "team-1" },
      { uid: "deleted-user", teamId: "team-1" },
    ]);
    const getUser = fakeGetUser({ "user-1": "one@example.com" });

    const result = await listTeamMembers("token", "team-1", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
      getUser,
    });

    expect(result).toEqual({
      ok: true,
      members: [{ uid: "user-1", email: "one@example.com" }],
    });
  });

  it("rejects an unauthenticated caller and attempts no read", async () => {
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));
    const collection = fakeCollection([]);

    const result = await listTeamMembers("bad-token", "team-1", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(collection.listRawForTeam).not.toHaveBeenCalled();
  });

  it("rejects a non-admin caller and attempts no read", async () => {
    const verifyToken = verifyTokenReturning(
      verifiedIdentity({ email: "dev@example.com" }),
    );
    const collection = fakeCollection([]);

    const result = await listTeamMembers("token", "team-1", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.listRawForTeam).not.toHaveBeenCalled();
  });

  it("reports failure, not a partial list, when the Firestore read fails", async () => {
    const verifyToken = verifyTokenReturning(verifiedIdentity());
    const collection: TeamMembersCollection = {
      listRawForTeam: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await listTeamMembers("token", "team-1", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("never includes the admin allow-list in the returned result", async () => {
    const allowList = [ADMIN_EMAIL, "other-admin@example.com"];
    const collection = fakeCollection([]);

    const result = await listTeamMembers("token", "team-1", {
      verifyToken: verifyTokenReturning(verifiedIdentity()),
      allowList,
      collection,
    });

    expect(JSON.stringify(result)).not.toContain("other-admin@example.com");
  });
});

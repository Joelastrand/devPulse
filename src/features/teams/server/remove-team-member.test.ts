import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { RemoveMemberCollection } from "./remove-team-member";
import { removeTeamMember } from "./remove-team-member";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_UID = "admin-1";
const isAdminUid = async (uid: string): Promise<boolean> => uid === ADMIN_UID;

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

function fakeCollection(): RemoveMemberCollection & {
  calls: Array<{ uid: string; teamId: string }>;
} {
  const calls: Array<{ uid: string; teamId: string }> = [];
  return {
    calls,
    async remove(uid, teamId) {
      calls.push({ uid, teamId });
    },
  };
}

describe("removeTeamMember", () => {
  it("removes a member's membership for an app admin", async () => {
    const collection = fakeCollection();
    const verifyToken = verifyTokenReturning(verifiedIdentity());

    const result = await removeTeamMember("token", "team-1", "user-1", {
      verifyToken,
      isSuperadmin: isAdminUid,
      collection,
    });

    expect(result).toEqual({ ok: true });
    expect(collection.calls).toEqual([{ uid: "user-1", teamId: "team-1" }]);
  });

  it("rejects an unauthenticated caller and attempts no removal", async () => {
    const collection = fakeCollection();
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await removeTeamMember("bad-token", "team-1", "user-1", {
      verifyToken,
      isSuperadmin: isAdminUid,
      collection,
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(collection.calls).toHaveLength(0);
  });

  it("rejects a non-admin caller and attempts no removal", async () => {
    const collection = fakeCollection();
    const verifyToken = verifyTokenReturning(
      verifiedIdentity({ uid: "non-admin-1", email: "dev@example.com" }),
    );

    const result = await removeTeamMember("token", "team-1", "user-1", {
      verifyToken,
      isSuperadmin: isAdminUid,
      collection,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.calls).toHaveLength(0);
  });

  it("reports failure, not partial success, when the Firestore delete fails", async () => {
    const verifyToken = verifyTokenReturning(verifiedIdentity());
    const collection: RemoveMemberCollection = {
      remove: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await removeTeamMember("token", "team-1", "user-1", {
      verifyToken,
      isSuperadmin: isAdminUid,
      collection,
    });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("never includes superadmin identifiers in the returned result", async () => {
    const isSuperadmin = isAdminUid;

    const result = await removeTeamMember("token", "team-1", "user-1", {
      verifyToken: verifyTokenReturning(verifiedIdentity()),
      isSuperadmin,
      collection: fakeCollection(),
    });

    expect(JSON.stringify(result)).not.toContain("other-admin@example.com");
  });

  it("never logs the token or identity for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const verifyToken = verifyTokenReturning(verifiedIdentity());
    await removeTeamMember("token", "team-1", "user-1", {
      verifyToken,
      isSuperadmin: isAdminUid,
      collection: fakeCollection(),
    });

    const failingCollection: RemoveMemberCollection = {
      remove: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    await removeTeamMember("token", "team-1", "user-1", {
      verifyToken,
      isSuperadmin: isAdminUid,
      collection: failingCollection,
    });

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

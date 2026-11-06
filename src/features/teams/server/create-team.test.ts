import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { TeamRecord, TeamsCollection } from "./create-team";
import { createTeam } from "./create-team";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_UID = "admin-1";
const isAdminUid = async (uid: string): Promise<boolean> => uid === ADMIN_UID;
const NOW = new Date("2026-09-01T00:00:00Z");

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

function fakeCollection(): TeamsCollection & { writes: TeamRecord[] } {
  const writes: TeamRecord[] = [];
  return {
    writes,
    add: vi.fn(async (record: TeamRecord) => {
      writes.push(record);
      return { id: `generated-${writes.length}` };
    }),
  };
}

describe("createTeam", () => {
  it("creates an active team with a server-generated teamId for an app admin", async () => {
    const collection = fakeCollection();
    const verifyToken = verifyTokenReturning(verifiedIdentity());

    const result = await createTeam("token", "Platform", {
      verifyToken,
      isSuperadmin: isAdminUid,
      collection,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, teamId: "generated-1" });
    expect(collection.writes).toEqual([
      { name: "Platform", status: "active", visibility: "private", createdAt: NOW, createdBy: "admin-1" },
    ]);
  });

  it("never derives teamId from the provided name", async () => {
    const collection = fakeCollection();
    const verifyToken = verifyTokenReturning(verifiedIdentity());

    const result = await createTeam("token", "Some Team Name", {
      verifyToken,
      isSuperadmin: isAdminUid,
      collection,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.teamId).not.toContain("some");
    expect(result.teamId).not.toContain("team");
  });

  it("rejects an unauthenticated caller and attempts no write", async () => {
    const collection = fakeCollection();
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await createTeam("bad-token", "Platform", {
      verifyToken,
      isSuperadmin: isAdminUid,
      collection,
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects a non-admin caller and attempts no write", async () => {
    const collection = fakeCollection();
    const verifyToken = verifyTokenReturning(
      verifiedIdentity({ uid: "non-admin-1", email: "dev@example.com" }),
    );

    const result = await createTeam("token", "Platform", {
      verifyToken,
      isSuperadmin: isAdminUid,
      collection,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects an allow-listed but unverified caller and attempts no write", async () => {
    const collection = fakeCollection();
    const verifyToken = verifyTokenReturning(
      verifiedIdentity({ emailVerified: false }),
    );

    const result = await createTeam("token", "Platform", {
      verifyToken,
      isSuperadmin: isAdminUid,
      collection,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects a missing/blank name and attempts no write", async () => {
    const collection = fakeCollection();
    const verifyToken = verifyTokenReturning(verifiedIdentity());

    const blank = await createTeam("token", "   ", {
      verifyToken,
      isSuperadmin: isAdminUid,
      collection,
    });
    const missing = await createTeam("token", undefined, {
      verifyToken,
      isSuperadmin: isAdminUid,
      collection,
    });

    expect(blank).toEqual({ ok: false, error: "invalid_name" });
    expect(missing).toEqual({ ok: false, error: "invalid_name" });
    expect(collection.writes).toHaveLength(0);
  });

  it("trims the stored name", async () => {
    const collection = fakeCollection();
    const verifyToken = verifyTokenReturning(verifiedIdentity());

    await createTeam("token", "  Platform  ", {
      verifyToken,
      isSuperadmin: isAdminUid,
      collection,
      now: NOW,
    });

    expect(collection.writes[0].name).toBe("Platform");
  });

  it("reports failure, not partial success, when the Firestore write fails", async () => {
    const verifyToken = verifyTokenReturning(verifiedIdentity());
    const collection: TeamsCollection = {
      add: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await createTeam("token", "Platform", {
      verifyToken,
      isSuperadmin: isAdminUid,
      collection,
    });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("never includes superadmin identifiers in the returned result, success or failure", async () => {
    const verifyToken = verifyTokenReturning(verifiedIdentity());
    const isSuperadmin = isAdminUid;

    const okResult = await createTeam("token", "Platform", {
      verifyToken,
      isSuperadmin,
      collection: fakeCollection(),
      now: NOW,
    });
    const forbiddenResult = await createTeam("token", "Platform", {
      verifyToken: verifyTokenReturning(
        verifiedIdentity({ uid: "non-admin-1", email: "dev@example.com" }),
      ),
      isSuperadmin,
      collection: fakeCollection(),
    });

    expect(JSON.stringify(okResult)).not.toContain("other-admin@example.com");
    expect(JSON.stringify(forbiddenResult)).not.toContain(
      "other-admin@example.com",
    );
  });

  it("never logs the token, identity, or admin allow-list for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const verifyToken = verifyTokenReturning(verifiedIdentity());
    await createTeam("token", "Platform", {
      verifyToken,
      isSuperadmin: isAdminUid,
      collection: fakeCollection(),
      now: NOW,
    });

    const failingCollection: TeamsCollection = {
      add: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    await createTeam("token", "Platform", {
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

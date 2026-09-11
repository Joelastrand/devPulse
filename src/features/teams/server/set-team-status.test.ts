import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { TeamStatusCollection } from "./set-team-status";
import { setTeamStatus } from "./set-team-status";

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

function fakeCollection(): TeamStatusCollection & {
  calls: Array<{ teamId: string; status: string }>;
} {
  const calls: Array<{ teamId: string; status: string }> = [];
  return {
    calls,
    async setStatus(teamId, status) {
      calls.push({ teamId, status });
    },
  };
}

describe("setTeamStatus", () => {
  it("disables an active team for an app admin", async () => {
    const collection = fakeCollection();
    const verifyToken = verifyTokenReturning(verifiedIdentity());

    const result = await setTeamStatus("token", "team-1", "disabled", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: true });
    expect(collection.calls).toEqual([{ teamId: "team-1", status: "disabled" }]);
  });

  it("re-enables a disabled team for an app admin", async () => {
    const collection = fakeCollection();
    const verifyToken = verifyTokenReturning(verifiedIdentity());

    const result = await setTeamStatus("token", "team-1", "active", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: true });
    expect(collection.calls).toEqual([{ teamId: "team-1", status: "active" }]);
  });

  it("rejects an unauthenticated caller and attempts no write", async () => {
    const collection = fakeCollection();
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await setTeamStatus("bad-token", "team-1", "disabled", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(collection.calls).toHaveLength(0);
  });

  it("rejects a non-admin caller and attempts no write", async () => {
    const collection = fakeCollection();
    const verifyToken = verifyTokenReturning(
      verifiedIdentity({ email: "dev@example.com" }),
    );

    const result = await setTeamStatus("token", "team-1", "disabled", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.calls).toHaveLength(0);
  });

  it("reports failure, not partial success, when the Firestore write fails", async () => {
    const verifyToken = verifyTokenReturning(verifiedIdentity());
    const collection: TeamStatusCollection = {
      setStatus: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await setTeamStatus("token", "team-1", "disabled", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("never includes the admin allow-list in the returned result, success or failure", async () => {
    const allowList = [ADMIN_EMAIL, "other-admin@example.com"];

    const okResult = await setTeamStatus("token", "team-1", "disabled", {
      verifyToken: verifyTokenReturning(verifiedIdentity()),
      allowList,
      collection: fakeCollection(),
    });
    const forbiddenResult = await setTeamStatus("token", "team-1", "disabled", {
      verifyToken: verifyTokenReturning(
        verifiedIdentity({ email: "dev@example.com" }),
      ),
      allowList,
      collection: fakeCollection(),
    });

    expect(JSON.stringify(okResult)).not.toContain("other-admin@example.com");
    expect(JSON.stringify(forbiddenResult)).not.toContain(
      "other-admin@example.com",
    );
  });

  it("never logs the token or identity for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const verifyToken = verifyTokenReturning(verifiedIdentity());
    await setTeamStatus("token", "team-1", "disabled", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      collection: fakeCollection(),
    });

    const failingCollection: TeamStatusCollection = {
      setStatus: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    await setTeamStatus("token", "team-1", "disabled", {
      verifyToken,
      allowList: [ADMIN_EMAIL],
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

import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { CancelInvitationCollection } from "./cancel-invitation";
import { cancelInvitation } from "./cancel-invitation";

const ADMIN_EMAIL = "admin@example.com";
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

function fakeCollection(
  existing: Record<string, unknown> = {},
): CancelInvitationCollection & { canceled: Array<{ teamId: string; email: string }> } {
  const canceled: Array<{ teamId: string; email: string }> = [];
  return {
    canceled,
    get: vi.fn(async (teamId: string, email: string) => existing[`${teamId}__${email}`]),
    markCanceled: vi.fn(async (teamId: string, email: string) => {
      canceled.push({ teamId, email });
    }),
  };
}

const baseDeps = {
  verifyToken: verifyTokenReturning(verifiedIdentity()),
  allowList: [ADMIN_EMAIL],
};

describe("cancelInvitation", () => {
  it("cancels a pending invitation", async () => {
    const collection = fakeCollection({
      "team-1__dev@example.com": {
        teamId: "team-1",
        email: "dev@example.com",
        status: "pending",
        invitedBy: "admin-1",
      },
    });

    const result = await cancelInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      collection,
      now: NOW,
    });

    expect(result).toEqual({ ok: true });
    expect(collection.canceled).toEqual([{ teamId: "team-1", email: "dev@example.com" }]);
  });

  it("normalizes case/whitespace before looking up the invitation", async () => {
    const collection = fakeCollection({
      "team-1__dev@example.com": {
        teamId: "team-1",
        email: "dev@example.com",
        status: "pending",
        invitedBy: "admin-1",
      },
    });

    const result = await cancelInvitation("token", "team-1", "  Dev@Example.COM ", {
      ...baseDeps,
      collection,
      now: NOW,
    });

    expect(result).toEqual({ ok: true });
    expect(collection.canceled).toEqual([{ teamId: "team-1", email: "dev@example.com" }]);
  });

  it("prevents a canceled invitation from being resolvable — a later create-invitation call must find no pending record", async () => {
    const collection = fakeCollection({
      "team-1__dev@example.com": {
        teamId: "team-1",
        email: "dev@example.com",
        status: "pending",
        invitedBy: "admin-1",
      },
    });

    await cancelInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      collection,
      now: NOW,
    });

    expect(collection.canceled).toHaveLength(1);
  });

  it("is a no-op success for a nonexistent invitation", async () => {
    const collection = fakeCollection();

    const result = await cancelInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      collection,
    });

    expect(result).toEqual({ ok: true });
    expect(collection.canceled).toHaveLength(0);
  });

  it("is a no-op success for an already-canceled or already-accepted invitation", async () => {
    const collection = fakeCollection({
      "team-1__dev@example.com": {
        teamId: "team-1",
        email: "dev@example.com",
        status: "accepted",
        invitedBy: "admin-1",
      },
    });

    const result = await cancelInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      collection,
    });

    expect(result).toEqual({ ok: true });
    expect(collection.canceled).toHaveLength(0);
  });

  it("rejects an unauthenticated caller and reads nothing", async () => {
    const collection = fakeCollection();

    const result = await cancelInvitation("bad-token", "team-1", "dev@example.com", {
      verifyToken: vi.fn().mockRejectedValue(new Error("bad token")),
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(collection.get).not.toHaveBeenCalled();
  });

  it("rejects a non-admin caller and reads nothing", async () => {
    const collection = fakeCollection();

    const result = await cancelInvitation("token", "team-1", "dev@example.com", {
      verifyToken: verifyTokenReturning(verifiedIdentity({ email: "dev@example.com" })),
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.get).not.toHaveBeenCalled();
  });

  it("rejects a missing/blank email", async () => {
    const collection = fakeCollection();

    const blank = await cancelInvitation("token", "team-1", "   ", { ...baseDeps, collection });
    const missing = await cancelInvitation("token", "team-1", undefined, {
      ...baseDeps,
      collection,
    });

    expect(blank).toEqual({ ok: false, error: "invalid_email" });
    expect(missing).toEqual({ ok: false, error: "invalid_email" });
  });

  it("reports a controlled failure when the read fails", async () => {
    const collection: CancelInvitationCollection = {
      get: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
      markCanceled: vi.fn(),
    };

    const result = await cancelInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      collection,
    });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("reports a controlled failure when the write fails", async () => {
    const collection: CancelInvitationCollection = {
      get: vi.fn().mockResolvedValue({
        teamId: "team-1",
        email: "dev@example.com",
        status: "pending",
        invitedBy: "admin-1",
      }),
      markCanceled: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await cancelInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      collection,
    });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("never leaks the underlying Firestore error's message into the result", async () => {
    const collection: CancelInvitationCollection = {
      get: vi
        .fn()
        .mockRejectedValue(new Error("permission-denied: service account misconfigured")),
      markCanceled: vi.fn(),
    };

    const result = await cancelInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      collection,
    });

    expect(JSON.stringify(result)).not.toContain("service account");
    expect(JSON.stringify(result)).not.toContain("permission-denied");
  });

  it("never logs the token, email, or admin allow-list for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await cancelInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      collection: fakeCollection(),
      now: NOW,
    });

    const failingCollection: CancelInvitationCollection = {
      get: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
      markCanceled: vi.fn(),
    };
    await cancelInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
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

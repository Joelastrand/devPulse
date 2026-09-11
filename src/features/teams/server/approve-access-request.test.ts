import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { ApproveAccessRequestCollection, ApproveOneOutcome } from "./approve-access-request";
import { approveAccessRequest } from "./approve-access-request";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_UID = "admin-1";
const NOW = new Date("2026-09-01T00:00:00Z");

function verifiedIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: ADMIN_UID, email: ADMIN_EMAIL, emailVerified: true, ...overrides };
}

function verifyTokenReturning(identity: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: identity.uid,
    email: identity.email,
    email_verified: identity.emailVerified,
  });
}

interface RawRequest {
  teamId: string;
  uid: string;
  status: "pending" | "approved" | "rejected";
}
interface RawMembership {
  uid: string;
  teamId: string;
  grantedBy: string;
}

/**
 * Faithfully simulates the production transaction's re-check-inside-the-
 * atomic-unit semantics against an in-memory store: re-reads both the
 * request and membership documents at approval time (not at call time),
 * and only ever writes a membership when the request is genuinely
 * `"pending"` and no membership already exists.
 */
function fakeCollection(seed: {
  requests?: Record<string, RawRequest>;
  memberships?: Record<string, RawMembership>;
}): ApproveAccessRequestCollection & {
  requests: Record<string, RawRequest>;
  memberships: Record<string, RawMembership>;
  approveOneCalls: number;
} {
  const requests: Record<string, RawRequest> = { ...(seed.requests ?? {}) };
  const memberships: Record<string, RawMembership> = { ...(seed.memberships ?? {}) };
  let approveOneCalls = 0;

  return {
    requests,
    memberships,
    get approveOneCalls() {
      return approveOneCalls;
    },
    async approveOne({ uid, teamId, resolvedBy, now }): Promise<ApproveOneOutcome> {
      approveOneCalls += 1;
      const reqKey = `${uid}__${teamId}`;
      const memKey = `${uid}__${teamId}`;

      const req = requests[reqKey];
      if (!req || req.teamId !== teamId || req.uid !== uid) {
        return "not_found";
      }
      if (req.status === "approved") {
        return "already_approved";
      }
      if (req.status !== "pending") {
        return "not_pending";
      }

      if (!memberships[memKey]) {
        memberships[memKey] = { uid, teamId, grantedBy: resolvedBy };
      }
      requests[reqKey] = { ...req, status: "approved" };
      void now;
      return "approved";
    },
  };
}

const baseDeps = {
  verifyToken: verifyTokenReturning(verifiedIdentity()),
  allowList: [ADMIN_EMAIL],
};

describe("approveAccessRequest", () => {
  it("approves a pending request, creating a uid-based membership and marking it approved (BR-27)", async () => {
    const collection = fakeCollection({
      requests: { "user-1__team-1": { teamId: "team-1", uid: "user-1", status: "pending" } },
    });

    const result = await approveAccessRequest("token", "user-1", "team-1", {
      ...baseDeps,
      collection,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, outcome: "approved" });
    expect(collection.memberships["user-1__team-1"]).toEqual({
      uid: "user-1",
      teamId: "team-1",
      grantedBy: ADMIN_UID,
    });
    expect(collection.requests["user-1__team-1"].status).toBe("approved");
  });

  it("is idempotent when approving an already-approved request, never re-attempting a membership write", async () => {
    const collection = fakeCollection({
      requests: { "user-1__team-1": { teamId: "team-1", uid: "user-1", status: "approved" } },
      memberships: { "user-1__team-1": { uid: "user-1", teamId: "team-1", grantedBy: ADMIN_UID } },
    });

    const result = await approveAccessRequest("token", "user-1", "team-1", {
      ...baseDeps,
      collection,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, outcome: "already_approved" });
  });

  it("never resurrects a membership that was removed after approval (idempotent retry does not re-grant)", async () => {
    const collection = fakeCollection({
      requests: { "user-1__team-1": { teamId: "team-1", uid: "user-1", status: "approved" } },
      memberships: {}, // membership was removed by an admin after the original approval
    });

    const result = await approveAccessRequest("token", "user-1", "team-1", {
      ...baseDeps,
      collection,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, outcome: "already_approved" });
    expect(collection.memberships["user-1__team-1"]).toBeUndefined();
  });

  it("does not approve a rejected request (converges safely, no membership created)", async () => {
    const collection = fakeCollection({
      requests: { "user-1__team-1": { teamId: "team-1", uid: "user-1", status: "rejected" } },
    });

    const result = await approveAccessRequest("token", "user-1", "team-1", {
      ...baseDeps,
      collection,
    });

    expect(result).toEqual({ ok: true, outcome: "not_pending" });
    expect(collection.memberships["user-1__team-1"]).toBeUndefined();
  });

  it("reports not_found for a nonexistent request and creates nothing", async () => {
    const collection = fakeCollection({});

    const result = await approveAccessRequest("token", "user-1", "team-1", {
      ...baseDeps,
      collection,
    });

    expect(result).toEqual({ ok: true, outcome: "not_found" });
    expect(Object.keys(collection.memberships)).toHaveLength(0);
  });

  it("does not duplicate membership when a membership already exists (independently created while approval was in flight)", async () => {
    const collection = fakeCollection({
      requests: { "user-1__team-1": { teamId: "team-1", uid: "user-1", status: "pending" } },
      memberships: {
        "user-1__team-1": { uid: "user-1", teamId: "team-1", grantedBy: "some-other-admin" },
      },
    });

    const result = await approveAccessRequest("token", "user-1", "team-1", {
      ...baseDeps,
      collection,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, outcome: "approved" });
    // the pre-existing membership's grantedBy is untouched — first-committer-wins,
    // approval never overwrites an existing membership document
    expect(collection.memberships["user-1__team-1"].grantedBy).toBe("some-other-admin");
    expect(collection.requests["user-1__team-1"].status).toBe("approved");
  });

  it("does not duplicate membership across two sequential approval attempts for the same request", async () => {
    const collection = fakeCollection({
      requests: { "user-1__team-1": { teamId: "team-1", uid: "user-1", status: "pending" } },
    });
    const deps = { ...baseDeps, collection, now: NOW };

    const first = await approveAccessRequest("token", "user-1", "team-1", deps);
    const second = await approveAccessRequest("token", "user-1", "team-1", deps);

    expect(first).toEqual({ ok: true, outcome: "approved" });
    expect(second).toEqual({ ok: true, outcome: "already_approved" });
    expect(Object.keys(collection.memberships)).toHaveLength(1);
  });

  it("rejects a non-admin caller and attempts no write", async () => {
    const collection = fakeCollection({
      requests: { "user-1__team-1": { teamId: "team-1", uid: "user-1", status: "pending" } },
    });

    const result = await approveAccessRequest("token", "user-1", "team-1", {
      verifyToken: verifyTokenReturning(verifiedIdentity({ email: "dev@example.com" })),
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.approveOneCalls).toBe(0);
  });

  it("rejects an unauthenticated caller and attempts no write", async () => {
    const collection = fakeCollection({
      requests: { "user-1__team-1": { teamId: "team-1", uid: "user-1", status: "pending" } },
    });

    const result = await approveAccessRequest("token", "user-1", "team-1", {
      verifyToken: vi.fn().mockRejectedValue(new Error("bad token")),
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(collection.approveOneCalls).toBe(0);
  });

  it("reports a controlled failure when the transaction fails", async () => {
    const collection: ApproveAccessRequestCollection = {
      approveOne: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await approveAccessRequest("token", "user-1", "team-1", {
      ...baseDeps,
      collection,
    });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("never leaks the underlying Firestore error's message into the result", async () => {
    const collection: ApproveAccessRequestCollection = {
      approveOne: vi
        .fn()
        .mockRejectedValue(new Error("permission-denied: service account misconfigured")),
    };

    const result = await approveAccessRequest("token", "user-1", "team-1", {
      ...baseDeps,
      collection,
    });

    expect(JSON.stringify(result)).not.toContain("service account");
    expect(JSON.stringify(result)).not.toContain("permission-denied");
  });

  it("never includes the admin allow-list in the returned result", async () => {
    const allowList = [ADMIN_EMAIL, "other-admin@example.com"];
    const collection = fakeCollection({
      requests: { "user-1__team-1": { teamId: "team-1", uid: "user-1", status: "pending" } },
    });

    const result = await approveAccessRequest("token", "user-1", "team-1", {
      verifyToken: verifyTokenReturning(verifiedIdentity()),
      allowList,
      collection,
      now: NOW,
    });

    expect(JSON.stringify(result)).not.toContain("other-admin@example.com");
  });

  it("never logs the token, identity, or admin allow-list for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await approveAccessRequest("token", "user-1", "team-1", {
      ...baseDeps,
      collection: fakeCollection({
        requests: { "user-1__team-1": { teamId: "team-1", uid: "user-1", status: "pending" } },
      }),
      now: NOW,
    });

    const failingCollection: ApproveAccessRequestCollection = {
      approveOne: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    await approveAccessRequest("token", "user-1", "team-1", {
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

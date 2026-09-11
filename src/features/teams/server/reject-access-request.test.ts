import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { RejectAccessRequestCollection, RejectOneOutcome } from "./reject-access-request";
import { rejectAccessRequest } from "./reject-access-request";
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

function fakeCollection(
  seed: Record<string, RawRequest> = {},
): RejectAccessRequestCollection & { requests: Record<string, RawRequest>; rejectOneCalls: number } {
  const requests: Record<string, RawRequest> = { ...seed };
  let rejectOneCalls = 0;
  return {
    requests,
    get rejectOneCalls() {
      return rejectOneCalls;
    },
    async rejectOne({ uid, teamId, resolvedBy }): Promise<RejectOneOutcome> {
      rejectOneCalls += 1;
      void resolvedBy;
      const key = `${uid}__${teamId}`;
      const req = requests[key];
      if (!req) return "not_found";
      if (req.status === "rejected") return "already_rejected";
      if (req.status !== "pending") return "not_pending";
      requests[key] = { ...req, status: "rejected" };
      return "rejected";
    },
  };
}

const baseDeps = {
  verifyToken: verifyTokenReturning(verifiedIdentity()),
  allowList: [ADMIN_EMAIL],
};

describe("rejectAccessRequest", () => {
  it("rejects a pending request and marks it rejected, never creating membership", async () => {
    const collection = fakeCollection({
      "user-1__team-1": { teamId: "team-1", uid: "user-1", status: "pending" },
    });

    const result = await rejectAccessRequest("token", "user-1", "team-1", {
      ...baseDeps,
      collection,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, outcome: "rejected" });
    expect(collection.requests["user-1__team-1"].status).toBe("rejected");
  });

  it("is idempotent when rejecting an already-rejected request", async () => {
    const collection = fakeCollection({
      "user-1__team-1": { teamId: "team-1", uid: "user-1", status: "rejected" },
    });

    const result = await rejectAccessRequest("token", "user-1", "team-1", {
      ...baseDeps,
      collection,
    });

    expect(result).toEqual({ ok: true, outcome: "already_rejected" });
  });

  it("does not reject (or undo) an already-approved request", async () => {
    const collection = fakeCollection({
      "user-1__team-1": { teamId: "team-1", uid: "user-1", status: "approved" },
    });

    const result = await rejectAccessRequest("token", "user-1", "team-1", {
      ...baseDeps,
      collection,
    });

    expect(result).toEqual({ ok: true, outcome: "not_pending" });
    expect(collection.requests["user-1__team-1"].status).toBe("approved");
  });

  it("reports not_found for a nonexistent request", async () => {
    const collection = fakeCollection({});

    const result = await rejectAccessRequest("token", "user-1", "team-1", {
      ...baseDeps,
      collection,
    });

    expect(result).toEqual({ ok: true, outcome: "not_found" });
  });

  it("rejects a non-admin caller and attempts no write", async () => {
    const collection = fakeCollection({
      "user-1__team-1": { teamId: "team-1", uid: "user-1", status: "pending" },
    });

    const result = await rejectAccessRequest("token", "user-1", "team-1", {
      verifyToken: verifyTokenReturning(verifiedIdentity({ email: "dev@example.com" })),
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.rejectOneCalls).toBe(0);
  });

  it("rejects an unauthenticated caller and attempts no write", async () => {
    const collection = fakeCollection({
      "user-1__team-1": { teamId: "team-1", uid: "user-1", status: "pending" },
    });

    const result = await rejectAccessRequest("token", "user-1", "team-1", {
      verifyToken: vi.fn().mockRejectedValue(new Error("bad token")),
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(collection.rejectOneCalls).toBe(0);
  });

  it("reports a controlled failure when the transaction fails", async () => {
    const collection: RejectAccessRequestCollection = {
      rejectOne: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await rejectAccessRequest("token", "user-1", "team-1", {
      ...baseDeps,
      collection,
    });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("never leaks the underlying Firestore error's message into the result", async () => {
    const collection: RejectAccessRequestCollection = {
      rejectOne: vi
        .fn()
        .mockRejectedValue(new Error("permission-denied: service account misconfigured")),
    };

    const result = await rejectAccessRequest("token", "user-1", "team-1", {
      ...baseDeps,
      collection,
    });

    expect(JSON.stringify(result)).not.toContain("service account");
    expect(JSON.stringify(result)).not.toContain("permission-denied");
  });

  it("never logs the token, identity, or admin allow-list for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await rejectAccessRequest("token", "user-1", "team-1", {
      ...baseDeps,
      collection: fakeCollection({
        "user-1__team-1": { teamId: "team-1", uid: "user-1", status: "pending" },
      }),
      now: NOW,
    });

    const failingCollection: RejectAccessRequestCollection = {
      rejectOne: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    await rejectAccessRequest("token", "user-1", "team-1", {
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

describe("approve/reject race convergence", () => {
  /**
   * A single shared in-memory store, exposed through both the
   * approve-side and reject-side collection interfaces, models what a
   * real Firestore transaction guarantees: whichever operation commits
   * first is authoritative, and the loser's re-read (on retry) observes
   * the new status rather than blindly overwriting it.
   */
  function sharedStore(seed: RawRequest) {
    const requests: Record<string, RawRequest> = {
      [`${seed.uid}__${seed.teamId}`]: seed,
    };
    const memberships: Record<string, { uid: string; teamId: string }> = {};

    const approveCollection: ApproveAccessRequestCollection = {
      async approveOne({ uid, teamId, resolvedBy }): Promise<ApproveOneOutcome> {
        void resolvedBy;
        const key = `${uid}__${teamId}`;
        const req = requests[key];
        if (!req) return "not_found";
        if (req.status === "approved") return "already_approved";
        if (req.status !== "pending") return "not_pending";
        memberships[key] = { uid, teamId };
        requests[key] = { ...req, status: "approved" };
        return "approved";
      },
    };

    const rejectCollection: RejectAccessRequestCollection = {
      async rejectOne({ uid, teamId, resolvedBy }): Promise<RejectOneOutcome> {
        void resolvedBy;
        const key = `${uid}__${teamId}`;
        const req = requests[key];
        if (!req) return "not_found";
        if (req.status === "rejected") return "already_rejected";
        if (req.status !== "pending") return "not_pending";
        requests[key] = { ...req, status: "rejected" };
        return "rejected";
      },
    };

    return { requests, memberships, approveCollection, rejectCollection };
  }

  it("approve-then-reject converges to approved membership, reject becomes a safe no-op", async () => {
    const { requests, memberships, approveCollection, rejectCollection } = sharedStore({
      teamId: "team-1",
      uid: "user-1",
      status: "pending",
    });

    const approveResult = await approveAccessRequest("token", "user-1", "team-1", {
      ...baseDeps,
      collection: approveCollection,
      now: NOW,
    });
    const rejectResult = await rejectAccessRequest("token", "user-1", "team-1", {
      ...baseDeps,
      collection: rejectCollection,
      now: NOW,
    });

    expect(approveResult).toEqual({ ok: true, outcome: "approved" });
    expect(rejectResult).toEqual({ ok: true, outcome: "not_pending" });
    expect(requests["user-1__team-1"].status).toBe("approved");
    expect(memberships["user-1__team-1"]).toEqual({ uid: "user-1", teamId: "team-1" });
  });

  it("reject-then-approve converges to rejected with no membership, approve becomes a safe no-op", async () => {
    const { requests, memberships, approveCollection, rejectCollection } = sharedStore({
      teamId: "team-1",
      uid: "user-1",
      status: "pending",
    });

    const rejectResult = await rejectAccessRequest("token", "user-1", "team-1", {
      ...baseDeps,
      collection: rejectCollection,
      now: NOW,
    });
    const approveResult = await approveAccessRequest("token", "user-1", "team-1", {
      ...baseDeps,
      collection: approveCollection,
      now: NOW,
    });

    expect(rejectResult).toEqual({ ok: true, outcome: "rejected" });
    expect(approveResult).toEqual({ ok: true, outcome: "not_pending" });
    expect(requests["user-1__team-1"].status).toBe("rejected");
    expect(memberships["user-1__team-1"]).toBeUndefined();
  });
});

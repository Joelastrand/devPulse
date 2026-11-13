import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { TeamAccessRequestsCollection } from "./list-team-access-requests";
import { listTeamAccessRequests } from "./list-team-access-requests";
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

function fakeCollection(rawDocs: unknown[]): TeamAccessRequestsCollection {
  return { listPendingRawForTeam: vi.fn().mockResolvedValue(rawDocs) };
}

function fakeGetUser(emails: Record<string, string>) {
  return vi.fn(async (uid: string) => {
    if (!(uid in emails)) {
      throw new Error("no such user");
    }
    return { email: emails[uid] };
  });
}

/**
 * Drains the microtask queue deep enough for a multi-layer `await` chain
 * (`requireAppAdmin` → `verifyIdToken` → the mocked `verifyToken`, then the
 * mocked Firestore read) to fully settle before the identity-lookup stage
 * begins — a fixed, generous number of microtask turns, never a real timer
 * or an elapsed-time assumption, so this stays deterministic.
 */
async function flushMicrotasks(turns = 20): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

const baseDeps = {
  verifyToken: verifyTokenReturning(verifiedIdentity()),
  isSuperadmin: isAdminUid,
};

describe("listTeamAccessRequests", () => {
  it("returns each pending request's uid, live-resolved email, and createdAt", async () => {
    const collection = fakeCollection([
      { teamId: "team-1", uid: "user-1", status: "pending", createdAt: CREATED_AT },
      { teamId: "team-1", uid: "user-2", status: "pending", createdAt: CREATED_AT },
    ]);
    const getUser = fakeGetUser({ "user-1": "one@nve.no", "user-2": "two@nve.no" });

    const result = await listTeamAccessRequests("token", "team-1", {
      ...baseDeps,
      collection,
      getUser,
    });

    expect(result).toEqual({
      ok: true,
      requests: [
        { uid: "user-1", email: "one@nve.no", createdAt: CREATED_AT },
        { uid: "user-2", email: "two@nve.no", createdAt: CREATED_AT },
      ],
    });
  });

  it("excludes a document for a different team or a non-pending status", async () => {
    const collection = fakeCollection([
      { teamId: "team-1", uid: "user-1", status: "pending", createdAt: CREATED_AT },
      { teamId: "other-team", uid: "user-2", status: "pending", createdAt: CREATED_AT },
      { teamId: "team-1", uid: "user-3", status: "approved", createdAt: CREATED_AT },
    ]);
    const getUser = fakeGetUser({ "user-1": "one@nve.no" });

    const result = await listTeamAccessRequests("token", "team-1", {
      ...baseDeps,
      collection,
      getUser,
    });

    expect(result).toEqual({
      ok: true,
      requests: [{ uid: "user-1", email: "one@nve.no", createdAt: CREATED_AT }],
    });
  });

  it("excludes a malformed document rather than crashing", async () => {
    const collection = fakeCollection([
      { teamId: "team-1", uid: "user-1", status: "pending", createdAt: CREATED_AT },
      { teamId: "team-1", status: "pending" }, // missing uid
      null,
    ]);
    const getUser = fakeGetUser({ "user-1": "one@nve.no" });

    const result = await listTeamAccessRequests("token", "team-1", {
      ...baseDeps,
      collection,
      getUser,
    });

    expect(result).toEqual({
      ok: true,
      requests: [{ uid: "user-1", email: "one@nve.no", createdAt: CREATED_AT }],
    });
  });

  it("excludes a requester whose uid no longer resolves to a live Firebase account", async () => {
    const collection = fakeCollection([
      { teamId: "team-1", uid: "user-1", status: "pending", createdAt: CREATED_AT },
      { teamId: "team-1", uid: "deleted-user", status: "pending", createdAt: CREATED_AT },
    ]);
    const getUser = fakeGetUser({ "user-1": "one@nve.no" });

    const result = await listTeamAccessRequests("token", "team-1", {
      ...baseDeps,
      collection,
      getUser,
    });

    expect(result).toEqual({
      ok: true,
      requests: [{ uid: "user-1", email: "one@nve.no", createdAt: CREATED_AT }],
    });
  });

  it("rejects an unauthenticated caller and attempts no read", async () => {
    const collection = fakeCollection([]);

    const result = await listTeamAccessRequests("bad-token", "team-1", {
      verifyToken: vi.fn().mockRejectedValue(new Error("bad token")),
      isSuperadmin: isAdminUid,
      collection,
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(collection.listPendingRawForTeam).not.toHaveBeenCalled();
  });

  it("rejects a non-admin caller and attempts no read", async () => {
    const collection = fakeCollection([]);

    const result = await listTeamAccessRequests("token", "team-1", {
      verifyToken: verifyTokenReturning(verifiedIdentity({ uid: "non-admin-1", email: "dev@nve.no" })),
      isSuperadmin: isAdminUid,
      collection,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.listPendingRawForTeam).not.toHaveBeenCalled();
  });

  it("reports failure, not a partial list, when the Firestore read fails", async () => {
    const collection: TeamAccessRequestsCollection = {
      listPendingRawForTeam: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await listTeamAccessRequests("token", "team-1", { ...baseDeps, collection });

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("never includes superadmin identifiers in the returned result", async () => {
    const isSuperadmin = isAdminUid;
    const collection = fakeCollection([]);

    const result = await listTeamAccessRequests("token", "team-1", {
      verifyToken: verifyTokenReturning(verifiedIdentity()),
      isSuperadmin,
      collection,
    });

    expect(JSON.stringify(result)).not.toContain("other-admin@nve.no");
  });

  it("resolves with zero identity lookups when there are no pending requests", async () => {
    const collection = fakeCollection([]);
    const getUser = vi.fn();

    const result = await listTeamAccessRequests("token", "team-1", {
      ...baseDeps,
      collection,
      getUser,
    });

    expect(result).toEqual({ ok: true, requests: [] });
    expect(getUser).not.toHaveBeenCalled();
  });

  it("resolves identity lookups concurrently — a later lookup begins before an earlier one resolves — and returns requests in input order regardless of resolution order", async () => {
    const collection = fakeCollection([
      { teamId: "team-1", uid: "user-a", status: "pending", createdAt: CREATED_AT },
      { teamId: "team-1", uid: "user-b", status: "pending", createdAt: CREATED_AT },
      { teamId: "team-1", uid: "user-c", status: "pending", createdAt: CREATED_AT },
    ]);

    const deferred: Record<string, (value: { email: string }) => void> = {};
    const invoked: string[] = [];
    const getUser = vi.fn((uid: string) => {
      invoked.push(uid);
      return new Promise<{ email: string }>((resolve) => {
        deferred[uid] = resolve;
      });
    });

    const resultPromise = listTeamAccessRequests("token", "team-1", {
      ...baseDeps,
      collection,
      getUser,
    });

    // Give the implementation's own async work (auth check, Firestore read)
    // a chance to settle. A sequential `for...of` loop would still be
    // awaiting "user-a" here, since we haven't resolved anything yet — this
    // is the assertion that fails against that implementation.
    await flushMicrotasks();

    expect(invoked).toEqual(["user-a", "user-b", "user-c"]);

    // Resolve deliberately out of input order.
    deferred["user-c"]({ email: "c@nve.no" });
    deferred["user-a"]({ email: "a@nve.no" });
    deferred["user-b"]({ email: "b@nve.no" });

    const result = await resultPromise;

    expect(result).toEqual({
      ok: true,
      requests: [
        { uid: "user-a", email: "a@nve.no", createdAt: CREATED_AT },
        { uid: "user-b", email: "b@nve.no", createdAt: CREATED_AT },
        { uid: "user-c", email: "c@nve.no", createdAt: CREATED_AT },
      ],
    });
  });

  it("excludes only the failing lookup when one of several concurrent lookups rejects", async () => {
    const collection = fakeCollection([
      { teamId: "team-1", uid: "user-a", status: "pending", createdAt: CREATED_AT },
      { teamId: "team-1", uid: "user-b", status: "pending", createdAt: CREATED_AT },
      { teamId: "team-1", uid: "user-c", status: "pending", createdAt: CREATED_AT },
    ]);
    const getUser = fakeGetUser({ "user-a": "a@nve.no", "user-c": "c@nve.no" });

    const result = await listTeamAccessRequests("token", "team-1", {
      ...baseDeps,
      collection,
      getUser,
    });

    expect(result).toEqual({
      ok: true,
      requests: [
        { uid: "user-a", email: "a@nve.no", createdAt: CREATED_AT },
        { uid: "user-c", email: "c@nve.no", createdAt: CREATED_AT },
      ],
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { ResolveInvitationsCollection, ResolveOneOutcome } from "./resolve-invitations";
import { resolveInvitations } from "./resolve-invitations";

const NOW = new Date("2026-09-01T00:00:00Z");

function identity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: "user-1", email: "dev@example.com", emailVerified: true, ...overrides };
}

interface RawInvitation {
  teamId: string;
  email: string;
  status: "pending" | "accepted" | "canceled";
  invitedBy: string;
}

interface RawMembership {
  uid: string;
  teamId: string;
  invitedBy: string;
}

/**
 * Faithfully simulates the production `resolveOne` transaction's atomic
 * read-modify-write semantics (re-checking status/membership at resolve
 * time, not at list time) against a small in-memory store, so tests can
 * exercise idempotency/race-handling behavior without a real Firestore
 * transaction.
 */
function fakeCollection(seed: {
  invitations?: Record<string, RawInvitation>;
  memberships?: Record<string, RawMembership>;
}): ResolveInvitationsCollection & {
  invitations: Record<string, RawInvitation>;
  memberships: Record<string, RawMembership>;
  resolveOneCalls: number;
} {
  const invitations: Record<string, RawInvitation> = { ...(seed.invitations ?? {}) };
  const memberships: Record<string, RawMembership> = { ...(seed.memberships ?? {}) };
  let resolveOneCalls = 0;

  return {
    invitations,
    memberships,
    get resolveOneCalls() {
      return resolveOneCalls;
    },
    async listRawForEmail(email) {
      return Object.values(invitations).filter(
        (inv) => inv.email === email && inv.status === "pending",
      );
    },
    async resolveOne({ teamId, email, uid, now }): Promise<ResolveOneOutcome> {
      resolveOneCalls += 1;
      const invKey = `${teamId}__${email}`;
      const memKey = `${uid}__${teamId}`;

      if (memberships[memKey]) {
        const inv = invitations[invKey];
        if (inv && inv.status === "pending" && inv.teamId === teamId && inv.email === email) {
          invitations[invKey] = { ...inv, status: "accepted" };
        }
        return "already_member";
      }

      const inv = invitations[invKey];
      if (!inv || inv.status !== "pending" || inv.teamId !== teamId || inv.email !== email) {
        return "no_longer_pending";
      }

      memberships[memKey] = { uid, teamId, invitedBy: inv.invitedBy };
      invitations[invKey] = { ...inv, status: "accepted" };
      void now;
      return "membership_created";
    },
  };
}

describe("resolveInvitations", () => {
  it("creates a membership for a verified matching email with a pending invitation (BR-20)", async () => {
    const collection = fakeCollection({
      invitations: {
        "team-1__dev@example.com": {
          teamId: "team-1",
          email: "dev@example.com",
          status: "pending",
          invitedBy: "admin-1",
        },
      },
    });

    const result = await resolveInvitations(identity(), { collection, now: NOW });

    expect(result).toEqual({ ok: true, membershipsCreated: 1 });
    expect(collection.memberships["user-1__team-1"]).toEqual({
      uid: "user-1",
      teamId: "team-1",
      invitedBy: "admin-1",
    });
    expect(collection.invitations["team-1__dev@example.com"].status).toBe("accepted");
  });

  it("resolves every pending invitation matching the caller's email across multiple teams", async () => {
    const collection = fakeCollection({
      invitations: {
        "team-1__dev@example.com": {
          teamId: "team-1",
          email: "dev@example.com",
          status: "pending",
          invitedBy: "admin-1",
        },
        "team-2__dev@example.com": {
          teamId: "team-2",
          email: "dev@example.com",
          status: "pending",
          invitedBy: "admin-2",
        },
      },
    });

    const result = await resolveInvitations(identity(), { collection, now: NOW });

    expect(result).toEqual({ ok: true, membershipsCreated: 2 });
  });

  it("does not resolve for an unverified caller, even with a matching pending invitation", async () => {
    const collection = fakeCollection({
      invitations: {
        "team-1__dev@example.com": {
          teamId: "team-1",
          email: "dev@example.com",
          status: "pending",
          invitedBy: "admin-1",
        },
      },
    });

    const result = await resolveInvitations(identity({ emailVerified: false }), {
      collection,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, membershipsCreated: 0 });
    expect(collection.resolveOneCalls).toBe(0);
    expect(collection.invitations["team-1__dev@example.com"].status).toBe("pending");
  });

  it("normalizes case/whitespace before matching the caller's email", async () => {
    const collection = fakeCollection({
      invitations: {
        "team-1__dev@example.com": {
          teamId: "team-1",
          email: "dev@example.com",
          status: "pending",
          invitedBy: "admin-1",
        },
      },
    });

    const result = await resolveInvitations(identity({ email: "  Dev@Example.COM " }), {
      collection,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, membershipsCreated: 1 });
  });

  it("never resolves a different user's invitation (exact-match, wrong-email caller)", async () => {
    const collection = fakeCollection({
      invitations: {
        "team-1__someone-else@example.com": {
          teamId: "team-1",
          email: "someone-else@example.com",
          status: "pending",
          invitedBy: "admin-1",
        },
      },
    });

    const result = await resolveInvitations(identity({ email: "dev@example.com" }), {
      collection,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, membershipsCreated: 0 });
    expect(collection.invitations["team-1__someone-else@example.com"].status).toBe("pending");
  });

  it("never resolves a canceled invitation", async () => {
    const collection = fakeCollection({
      invitations: {
        "team-1__dev@example.com": {
          teamId: "team-1",
          email: "dev@example.com",
          status: "canceled",
          invitedBy: "admin-1",
        },
      },
    });

    const result = await resolveInvitations(identity(), { collection, now: NOW });

    expect(result).toEqual({ ok: true, membershipsCreated: 0 });
    expect(collection.memberships).toEqual({});
  });

  it("is idempotent when the caller already holds membership (marks a stale pending invitation resolved, creates no duplicate)", async () => {
    const collection = fakeCollection({
      invitations: {
        "team-1__dev@example.com": {
          teamId: "team-1",
          email: "dev@example.com",
          status: "pending",
          invitedBy: "admin-1",
        },
      },
      memberships: {
        "user-1__team-1": { uid: "user-1", teamId: "team-1", invitedBy: "admin_direct" },
      },
    });

    const result = await resolveInvitations(identity(), { collection, now: NOW });

    expect(result).toEqual({ ok: true, membershipsCreated: 0 });
    expect(collection.invitations["team-1__dev@example.com"].status).toBe("accepted");
    expect(Object.keys(collection.memberships)).toHaveLength(1);
  });

  it("does not create a duplicate membership on a second, duplicate resolution attempt", async () => {
    const collection = fakeCollection({
      invitations: {
        "team-1__dev@example.com": {
          teamId: "team-1",
          email: "dev@example.com",
          status: "pending",
          invitedBy: "admin-1",
        },
      },
    });

    const first = await resolveInvitations(identity(), { collection, now: NOW });
    const second = await resolveInvitations(identity(), { collection, now: NOW });

    expect(first).toEqual({ ok: true, membershipsCreated: 1 });
    expect(second).toEqual({ ok: true, membershipsCreated: 0 });
    expect(Object.keys(collection.memberships)).toHaveLength(1);
  });

  it("skips a malformed invitation document (missing/non-string teamId) without crashing", async () => {
    const collection: ResolveInvitationsCollection = {
      listRawForEmail: vi
        .fn()
        .mockResolvedValue([{ email: "dev@example.com", status: "pending", invitedBy: "admin-1" }]),
      resolveOne: vi.fn(),
    };

    const result = await resolveInvitations(identity(), { collection, now: NOW });

    expect(result).toEqual({ ok: true, membershipsCreated: 0 });
    expect(collection.resolveOne).not.toHaveBeenCalled();
  });

  it("skips a non-object raw invitation entry without crashing", async () => {
    const collection: ResolveInvitationsCollection = {
      listRawForEmail: vi.fn().mockResolvedValue([null, "not an object", 42]),
      resolveOne: vi.fn(),
    };

    const result = await resolveInvitations(identity(), { collection, now: NOW });

    expect(result).toEqual({ ok: true, membershipsCreated: 0 });
    expect(collection.resolveOne).not.toHaveBeenCalled();
  });

  it("reports a controlled failure when the invitation read fails", async () => {
    const collection: ResolveInvitationsCollection = {
      listRawForEmail: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
      resolveOne: vi.fn(),
    };

    const result = await resolveInvitations(identity(), { collection });

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("reports a controlled failure, not partial success, when the transactional resolve fails", async () => {
    const collection: ResolveInvitationsCollection = {
      listRawForEmail: vi
        .fn()
        .mockResolvedValue([
          { teamId: "team-1", email: "dev@example.com", status: "pending", invitedBy: "admin-1" },
        ]),
      resolveOne: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await resolveInvitations(identity(), { collection });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("never leaks the underlying Firestore error's message into the result", async () => {
    const collection: ResolveInvitationsCollection = {
      listRawForEmail: vi
        .fn()
        .mockRejectedValue(new Error("permission-denied: service account misconfigured")),
      resolveOne: vi.fn(),
    };

    const result = await resolveInvitations(identity(), { collection });

    expect(JSON.stringify(result)).not.toContain("service account");
    expect(JSON.stringify(result)).not.toContain("permission-denied");
  });

  it("never logs the identity or invitation content for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const collection = fakeCollection({
      invitations: {
        "team-1__dev@example.com": {
          teamId: "team-1",
          email: "dev@example.com",
          status: "pending",
          invitedBy: "admin-1",
        },
      },
    });
    await resolveInvitations(identity(), { collection, now: NOW });

    const failingCollection: ResolveInvitationsCollection = {
      listRawForEmail: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
      resolveOne: vi.fn(),
    };
    await resolveInvitations(identity(), { collection: failingCollection });

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

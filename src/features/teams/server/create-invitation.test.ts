import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { TeamInvitationRecord } from "../domain/team-invitation";
import type { GrantTeamMembershipCollection } from "./grant-team-membership";
import type {
  CreateInvitationInvitationsCollection,
  CreateInvitationMembershipsCollection,
  CreateInvitationTeamsCollection,
  GetUserByEmail,
} from "./create-invitation";
import { createInvitation } from "./create-invitation";

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

function fakeTeams(statuses: Record<string, unknown>): CreateInvitationTeamsCollection {
  return { getStatus: vi.fn(async (teamId: string) => statuses[teamId]) };
}

function fakeMemberships(
  existing: Record<string, unknown> = {},
): CreateInvitationMembershipsCollection {
  return {
    get: vi.fn(async (uid: string, teamId: string) => existing[`${uid}__${teamId}`]),
  };
}

/**
 * A membership read-side (`CreateInvitationMembershipsCollection`) and the
 * atomic grant helper (`GrantTeamMembershipCollection`) backed by the SAME
 * underlying store — models a realistic end-to-end flow where a
 * transactionally-created membership is visible to a later pre-check, used
 * for idempotency-across-repeated-calls tests.
 */
function fakeMembershipStore(): {
  membershipsCollection: CreateInvitationMembershipsCollection;
  grantMembershipCollection: GrantTeamMembershipCollection & { writes: unknown[] };
  store: Record<string, unknown>;
} {
  const store: Record<string, unknown> = {};
  const writes: unknown[] = [];
  return {
    store,
    membershipsCollection: {
      get: vi.fn(async (uid: string, teamId: string) => store[`${uid}__${teamId}`]),
    },
    grantMembershipCollection: {
      writes,
      runGrant: vi.fn(async (record: { uid: string; teamId: string }) => {
        const key = `${record.uid}__${record.teamId}`;
        if (store[key]) {
          return "already_member" as const;
        }
        store[key] = record;
        writes.push(record);
        return "created" as const;
      }),
    },
  };
}

interface RawInvitation {
  teamId: string;
  email: string;
  status: "pending" | "accepted" | "canceled";
  invitedBy: string;
}

function fakeInvitations(
  seed: Record<string, RawInvitation> = {},
): CreateInvitationInvitationsCollection & {
  store: Record<string, RawInvitation>;
  writes: TeamInvitationRecord[];
  accepted: Array<{ teamId: string; email: string; resolvedUid: string }>;
} {
  const store: Record<string, RawInvitation> = { ...seed };
  const writes: TeamInvitationRecord[] = [];
  const accepted: Array<{ teamId: string; email: string; resolvedUid: string }> = [];
  return {
    store,
    writes,
    accepted,
    get: vi.fn(async (teamId: string, email: string) => store[`${teamId}__${email}`]),
    setPending: vi.fn(async (record: TeamInvitationRecord) => {
      store[`${record.teamId}__${record.email}`] = record;
      writes.push(record);
    }),
    markAccepted: vi.fn(async (teamId: string, email: string, resolvedUid: string, now: Date) => {
      const key = `${teamId}__${email}`;
      const existing = store[key];
      store[key] = {
        ...(existing as RawInvitation),
        status: "accepted",
        // updatedAt/resolvedAt aren't part of RawInvitation's narrow type
        // above but are harmless extra fields for test-store purposes.
      } as RawInvitation;
      void now;
      accepted.push({ teamId, email, resolvedUid });
    }),
  };
}

function fakeGetUserByEmail(
  accounts: Record<string, { uid: string; emailVerified: boolean }>,
): GetUserByEmail {
  return vi.fn(async (email: string) => accounts[email] ?? null);
}

const baseDeps = {
  verifyToken: verifyTokenReturning(verifiedIdentity()),
  allowList: [ADMIN_EMAIL],
};

describe("createInvitation", () => {
  it("creates membership immediately for an email with an existing verified account (BR-18)", async () => {
    const teams = fakeTeams({ "team-1": "active" });
    const { membershipsCollection, grantMembershipCollection } = fakeMembershipStore();
    const invitations = fakeInvitations();
    const getUserByEmail = fakeGetUserByEmail({
      "dev@example.com": { uid: "user-1", emailVerified: true },
    });

    const result = await createInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection,
      invitationsCollection: invitations,
      getUserByEmail,
      grantMembershipCollection,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, outcome: "membership_created" });
    expect(grantMembershipCollection.writes).toEqual([
      { uid: "user-1", teamId: "team-1", createdAt: NOW, createdVia: "invitation", grantedBy: ADMIN_UID },
    ]);
    expect(invitations.writes).toHaveLength(0);
  });

  it("creates exactly one pending invitation for an email with no matching account (BR-18)", async () => {
    const teams = fakeTeams({ "team-1": "active" });
    const memberships = fakeMemberships();
    const invitations = fakeInvitations();
    const getUserByEmail = fakeGetUserByEmail({});

    const result = await createInvitation("token", "team-1", "unknown@example.com", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection: memberships,
      invitationsCollection: invitations,
      getUserByEmail,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, outcome: "invitation_created" });
    expect(invitations.writes).toEqual([
      {
        teamId: "team-1",
        email: "unknown@example.com",
        status: "pending",
        invitedBy: ADMIN_UID,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
  });

  it("does not grant membership for an existing but unverified account, retains a pending invitation, and never touches invitation-accept cleanup", async () => {
    const teams = fakeTeams({ "team-1": "active" });
    const memberships = fakeMemberships();
    const invitations = fakeInvitations();
    const getUserByEmail = fakeGetUserByEmail({
      "dev@example.com": { uid: "user-1", emailVerified: false },
    });

    const result = await createInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection: memberships,
      invitationsCollection: invitations,
      getUserByEmail,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, outcome: "invitation_created" });
    expect(invitations.writes).toEqual([
      {
        teamId: "team-1",
        email: "dev@example.com",
        status: "pending",
        invitedBy: ADMIN_UID,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
    expect(invitations.accepted).toHaveLength(0);
  });

  it("is idempotent when re-inviting a still-pending email (BR-19)", async () => {
    const teams = fakeTeams({ "team-1": "active" });
    const memberships = fakeMemberships();
    const invitations = fakeInvitations({
      "team-1__unknown@example.com": {
        teamId: "team-1",
        email: "unknown@example.com",
        status: "pending",
        invitedBy: ADMIN_UID,
      },
    });
    const getUserByEmail = fakeGetUserByEmail({});

    const result = await createInvitation("token", "team-1", "Unknown@Example.com", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection: memberships,
      invitationsCollection: invitations,
      getUserByEmail,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, outcome: "invitation_already_pending" });
    expect(invitations.writes).toHaveLength(0);
  });

  it("normalizes case and surrounding whitespace before matching/storing", async () => {
    const teams = fakeTeams({ "team-1": "active" });
    const memberships = fakeMemberships();
    const invitations = fakeInvitations();
    const getUserByEmail = fakeGetUserByEmail({});

    await createInvitation("token", "team-1", "  Dev@Example.COM  ", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection: memberships,
      invitationsCollection: invitations,
      getUserByEmail,
      now: NOW,
    });

    expect(getUserByEmail).toHaveBeenCalledWith("dev@example.com");
    expect(invitations.writes[0].email).toBe("dev@example.com");
  });

  it("creates a fresh pending invitation after a previous one was canceled (no account exists)", async () => {
    const teams = fakeTeams({ "team-1": "active" });
    const memberships = fakeMemberships();
    const invitations = fakeInvitations({
      "team-1__unknown@example.com": {
        teamId: "team-1",
        email: "unknown@example.com",
        status: "canceled",
        invitedBy: ADMIN_UID,
      },
    });
    const getUserByEmail = fakeGetUserByEmail({});

    const result = await createInvitation("token", "team-1", "unknown@example.com", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection: memberships,
      invitationsCollection: invitations,
      getUserByEmail,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, outcome: "invitation_created" });
    expect(invitations.writes).toHaveLength(1);
    expect(invitations.writes[0].status).toBe("pending");
  });

  it("leaves a canceled invitation untouched (never silently accepted) when a fresh invite immediately grants membership", async () => {
    const teams = fakeTeams({ "team-1": "active" });
    const { membershipsCollection, grantMembershipCollection } = fakeMembershipStore();
    const invitations = fakeInvitations({
      "team-1__dev@example.com": {
        teamId: "team-1",
        email: "dev@example.com",
        status: "canceled",
        invitedBy: "some-earlier-admin",
      },
    });
    const getUserByEmail = fakeGetUserByEmail({
      "dev@example.com": { uid: "user-1", emailVerified: true },
    });

    const result = await createInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection,
      invitationsCollection: invitations,
      getUserByEmail,
      grantMembershipCollection,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, outcome: "membership_created" });
    expect(invitations.accepted).toHaveLength(0);
    expect(invitations.store["team-1__dev@example.com"].status).toBe("canceled");
  });

  it("leaves an already-accepted invitation untouched (no regression to pending, no duplicate accept) when membership is (re-)granted", async () => {
    const teams = fakeTeams({ "team-1": "active" });
    const { membershipsCollection, grantMembershipCollection } = fakeMembershipStore();
    const invitations = fakeInvitations({
      "team-1__dev@example.com": {
        teamId: "team-1",
        email: "dev@example.com",
        status: "accepted",
        invitedBy: "some-earlier-admin",
      },
    });
    const getUserByEmail = fakeGetUserByEmail({
      "dev@example.com": { uid: "user-1", emailVerified: true },
    });

    const result = await createInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection,
      invitationsCollection: invitations,
      getUserByEmail,
      grantMembershipCollection,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, outcome: "membership_created" });
    expect(invitations.accepted).toHaveLength(0);
    expect(invitations.store["team-1__dev@example.com"].status).toBe("accepted");
  });

  it("transitions a pre-existing pending invitation to accepted when the invited email now resolves to a verified account and gains membership", async () => {
    const teams = fakeTeams({ "team-1": "active" });
    const { membershipsCollection, grantMembershipCollection } = fakeMembershipStore();
    const invitations = fakeInvitations({
      "team-1__dev@example.com": {
        teamId: "team-1",
        email: "dev@example.com",
        status: "pending",
        invitedBy: "some-earlier-admin",
      },
    });
    const getUserByEmail = fakeGetUserByEmail({
      "dev@example.com": { uid: "user-1", emailVerified: true },
    });

    const result = await createInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection,
      invitationsCollection: invitations,
      getUserByEmail,
      grantMembershipCollection,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, outcome: "membership_created" });
    expect(grantMembershipCollection.writes).toHaveLength(1);
    expect(invitations.accepted).toEqual([
      { teamId: "team-1", email: "dev@example.com", resolvedUid: "user-1" },
    ]);
    expect(invitations.store["team-1__dev@example.com"].status).toBe("accepted");
    // no NEW pending record was created for this immediate grant
    expect(invitations.writes).toHaveLength(0);
  });

  it("transitions a pre-existing pending invitation to accepted when the invited email already has membership (no stale pending record remains)", async () => {
    const teams = fakeTeams({ "team-1": "active" });
    const memberships = fakeMemberships({ "user-1__team-1": { uid: "user-1", teamId: "team-1" } });
    const invitations = fakeInvitations({
      "team-1__dev@example.com": {
        teamId: "team-1",
        email: "dev@example.com",
        status: "pending",
        invitedBy: "some-earlier-admin",
      },
    });
    const getUserByEmail = fakeGetUserByEmail({
      "dev@example.com": { uid: "user-1", emailVerified: true },
    });

    const result = await createInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection: memberships,
      invitationsCollection: invitations,
      getUserByEmail,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, outcome: "already_member" });
    expect(invitations.accepted).toEqual([
      { teamId: "team-1", email: "dev@example.com", resolvedUid: "user-1" },
    ]);
    expect(invitations.store["team-1__dev@example.com"].status).toBe("accepted");
  });

  it("is idempotent across repeated immediate-grant invites for the same verified account", async () => {
    const teams = fakeTeams({ "team-1": "active" });
    const { membershipsCollection, grantMembershipCollection } = fakeMembershipStore();
    const invitations = fakeInvitations();
    const getUserByEmail = fakeGetUserByEmail({
      "dev@example.com": { uid: "user-1", emailVerified: true },
    });
    const deps = {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection,
      invitationsCollection: invitations,
      getUserByEmail,
      grantMembershipCollection,
      now: NOW,
    };

    const first = await createInvitation("token", "team-1", "dev@example.com", deps);
    const second = await createInvitation("token", "team-1", "dev@example.com", deps);

    expect(first).toEqual({ ok: true, outcome: "membership_created" });
    expect(second).toEqual({ ok: true, outcome: "already_member" });
    expect(grantMembershipCollection.writes).toHaveLength(1);
  });

  it("rejects inviting an already-member email as a no-op, creating no duplicate invitation/membership (BR-22)", async () => {
    const teams = fakeTeams({ "team-1": "active" });
    const memberships = fakeMemberships({
      "user-1__team-1": { uid: "user-1", teamId: "team-1" },
    });
    const invitations = fakeInvitations();
    const getUserByEmail = fakeGetUserByEmail({
      "dev@example.com": { uid: "user-1", emailVerified: true },
    });

    const result = await createInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection: memberships,
      invitationsCollection: invitations,
      getUserByEmail,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, outcome: "already_member" });
    expect(invitations.writes).toHaveLength(0);
  });

  it("reports already_member (not membership_created) when the transactional grant discovers a concurrently-created membership (grantedBy race safety)", async () => {
    const teams = fakeTeams({ "team-1": "active" });
    const memberships = fakeMemberships(); // stale pre-check: finds nothing yet
    const invitations = fakeInvitations();
    const grantMembershipCollection: GrantTeamMembershipCollection = {
      // Simulates resolveInvitations' own transaction having already won the race.
      runGrant: vi.fn().mockResolvedValue("already_member"),
    };
    const getUserByEmail = fakeGetUserByEmail({
      "dev@example.com": { uid: "user-1", emailVerified: true },
    });

    const result = await createInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection: memberships,
      invitationsCollection: invitations,
      getUserByEmail,
      grantMembershipCollection,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, outcome: "already_member" });
  });

  it("rejects a nonexistent team and creates nothing", async () => {
    const teams = fakeTeams({});
    const memberships = fakeMemberships();
    const invitations = fakeInvitations();
    const getUserByEmail = fakeGetUserByEmail({});

    const result = await createInvitation("token", "missing-team", "dev@example.com", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection: memberships,
      invitationsCollection: invitations,
      getUserByEmail,
    });

    expect(result).toEqual({ ok: false, error: "team_not_found" });
    expect(getUserByEmail).not.toHaveBeenCalled();
    expect(invitations.writes).toHaveLength(0);
  });

  it("fails closed for a malformed/unrecognized team status", async () => {
    const teams = fakeTeams({ "team-1": "archived" });
    const getUserByEmail = fakeGetUserByEmail({});

    const result = await createInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection: fakeMemberships(),
      invitationsCollection: fakeInvitations(),
      getUserByEmail,
    });

    expect(result).toEqual({ ok: false, error: "team_not_found" });
    expect(getUserByEmail).not.toHaveBeenCalled();
  });

  it("rejects a disabled team and creates nothing", async () => {
    const teams = fakeTeams({ "team-1": "disabled" });
    const memberships = fakeMemberships();
    const invitations = fakeInvitations();
    const getUserByEmail = fakeGetUserByEmail({});

    const result = await createInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection: memberships,
      invitationsCollection: invitations,
      getUserByEmail,
    });

    expect(result).toEqual({ ok: false, error: "team_disabled" });
    expect(getUserByEmail).not.toHaveBeenCalled();
    expect(invitations.writes).toHaveLength(0);
  });

  it("rejects an unauthenticated caller and reads nothing", async () => {
    const teams = fakeTeams({ "team-1": "active" });
    const getUserByEmail = fakeGetUserByEmail({});

    const result = await createInvitation("bad-token", "team-1", "dev@example.com", {
      verifyToken: vi.fn().mockRejectedValue(new Error("bad token")),
      allowList: [ADMIN_EMAIL],
      teamsCollection: teams,
      membershipsCollection: fakeMemberships(),
      invitationsCollection: fakeInvitations(),
      getUserByEmail,
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(teams.getStatus).not.toHaveBeenCalled();
    expect(getUserByEmail).not.toHaveBeenCalled();
  });

  it("rejects a non-admin caller and reads nothing", async () => {
    const teams = fakeTeams({ "team-1": "active" });
    const getUserByEmail = fakeGetUserByEmail({});

    const result = await createInvitation("token", "team-1", "dev@example.com", {
      verifyToken: verifyTokenReturning(verifiedIdentity({ email: "dev@example.com" })),
      allowList: [ADMIN_EMAIL],
      teamsCollection: teams,
      membershipsCollection: fakeMemberships(),
      invitationsCollection: fakeInvitations(),
      getUserByEmail,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(teams.getStatus).not.toHaveBeenCalled();
    expect(getUserByEmail).not.toHaveBeenCalled();
  });

  it("rejects a missing/blank email", async () => {
    const teams = fakeTeams({ "team-1": "active" });

    const blank = await createInvitation("token", "team-1", "   ", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection: fakeMemberships(),
      invitationsCollection: fakeInvitations(),
    });
    const missing = await createInvitation("token", "team-1", undefined, {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection: fakeMemberships(),
      invitationsCollection: fakeInvitations(),
    });

    expect(blank).toEqual({ ok: false, error: "invalid_email" });
    expect(missing).toEqual({ ok: false, error: "invalid_email" });
  });

  it("reports a controlled failure when the Firebase Auth lookup fails, and creates nothing", async () => {
    const teams = fakeTeams({ "team-1": "active" });
    const memberships = fakeMemberships();
    const invitations = fakeInvitations();
    const getUserByEmail = vi.fn().mockRejectedValue(new Error("simulated Auth outage"));

    const result = await createInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection: memberships,
      invitationsCollection: invitations,
      getUserByEmail,
    });

    expect(result).toEqual({ ok: false, error: "lookup_failed" });
    expect(invitations.writes).toHaveLength(0);
  });

  it("reports a controlled failure when the team status read fails", async () => {
    const teams: CreateInvitationTeamsCollection = {
      getStatus: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await createInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection: fakeMemberships(),
      invitationsCollection: fakeInvitations(),
    });

    expect(result).toEqual({ ok: false, error: "lookup_failed" });
  });

  it("reports a controlled failure, not partial success, when the membership grant transaction fails", async () => {
    const teams = fakeTeams({ "team-1": "active" });
    const memberships = fakeMemberships();
    const grantMembershipCollection: GrantTeamMembershipCollection = {
      runGrant: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    const getUserByEmail = fakeGetUserByEmail({
      "dev@example.com": { uid: "user-1", emailVerified: true },
    });

    const result = await createInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection: memberships,
      invitationsCollection: fakeInvitations(),
      getUserByEmail,
      grantMembershipCollection,
    });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("reports a controlled failure, not partial success, when the invitation write fails", async () => {
    const teams = fakeTeams({ "team-1": "active" });
    const invitations: CreateInvitationInvitationsCollection = {
      get: vi.fn().mockResolvedValue(undefined),
      setPending: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
      markAccepted: vi.fn(),
    };
    const getUserByEmail = fakeGetUserByEmail({});

    const result = await createInvitation("token", "team-1", "unknown@example.com", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection: fakeMemberships(),
      invitationsCollection: invitations,
      getUserByEmail,
    });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("reports a controlled failure, not false success, when the invitation-accept transition fails after membership was newly granted", async () => {
    const teams = fakeTeams({ "team-1": "active" });
    const { membershipsCollection, grantMembershipCollection } = fakeMembershipStore();
    const invitations: CreateInvitationInvitationsCollection = {
      get: vi.fn().mockResolvedValue({
        teamId: "team-1",
        email: "dev@example.com",
        status: "pending",
        invitedBy: "some-earlier-admin",
      }),
      setPending: vi.fn(),
      markAccepted: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    const getUserByEmail = fakeGetUserByEmail({
      "dev@example.com": { uid: "user-1", emailVerified: true },
    });

    const result = await createInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection,
      invitationsCollection: invitations,
      getUserByEmail,
      grantMembershipCollection,
      now: NOW,
    });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    // Membership WAS granted before the failure — this asserts the failure
    // is reported rather than silently swallowed, not that the grant itself
    // rolled back (it can't, across two independent Firestore writes).
    expect(grantMembershipCollection.writes).toHaveLength(1);
  });

  it("reports a controlled failure, not false success, when the invitation-accept transition fails in the already-member path", async () => {
    const teams = fakeTeams({ "team-1": "active" });
    const memberships: CreateInvitationMembershipsCollection = {
      get: vi.fn().mockResolvedValue({ uid: "user-1", teamId: "team-1" }),
    };
    const invitations: CreateInvitationInvitationsCollection = {
      get: vi.fn().mockResolvedValue({
        teamId: "team-1",
        email: "dev@example.com",
        status: "pending",
        invitedBy: "some-earlier-admin",
      }),
      setPending: vi.fn(),
      markAccepted: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    const getUserByEmail = fakeGetUserByEmail({
      "dev@example.com": { uid: "user-1", emailVerified: true },
    });

    const result = await createInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection: memberships,
      invitationsCollection: invitations,
      getUserByEmail,
      now: NOW,
    });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("never leaks the underlying Firestore/Auth error's message into the result", async () => {
    const teams: CreateInvitationTeamsCollection = {
      getStatus: vi
        .fn()
        .mockRejectedValue(new Error("permission-denied: service account misconfigured")),
    };

    const result = await createInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      teamsCollection: teams,
      membershipsCollection: fakeMemberships(),
      invitationsCollection: fakeInvitations(),
    });

    expect(JSON.stringify(result)).not.toContain("service account");
    expect(JSON.stringify(result)).not.toContain("permission-denied");
  });

  it("never includes the admin allow-list in the returned result", async () => {
    const allowList = [ADMIN_EMAIL, "other-admin@example.com"];
    const teams = fakeTeams({ "team-1": "active" });

    const result = await createInvitation("token", "team-1", "dev@example.com", {
      verifyToken: verifyTokenReturning(verifiedIdentity()),
      allowList,
      teamsCollection: teams,
      membershipsCollection: fakeMemberships(),
      invitationsCollection: fakeInvitations(),
      getUserByEmail: fakeGetUserByEmail({}),
    });

    expect(JSON.stringify(result)).not.toContain("other-admin@example.com");
  });

  it("never logs the token, email, identity, or admin allow-list for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await createInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      teamsCollection: fakeTeams({ "team-1": "active" }),
      membershipsCollection: fakeMemberships(),
      invitationsCollection: fakeInvitations(),
      getUserByEmail: fakeGetUserByEmail({}),
      now: NOW,
    });

    const failingTeams: CreateInvitationTeamsCollection = {
      getStatus: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    await createInvitation("token", "team-1", "dev@example.com", {
      ...baseDeps,
      teamsCollection: failingTeams,
      membershipsCollection: fakeMemberships(),
      invitationsCollection: fakeInvitations(),
    });

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

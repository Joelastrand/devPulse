import { describe, expect, it } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { AuthorizeTeamAccessCollection } from "./authorize-team-access";
import { authorizeTeamAccess } from "./authorize-team-access";

const ADMIN_EMAIL = "admin@example.com";
const MEMBER_UID = "member-1";
const OTHER_TEAM_ID = "other-team";

function identity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: MEMBER_UID, email: "dev@example.com", emailVerified: true, ...overrides };
}

function adminIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return identity({ email: ADMIN_EMAIL, ...overrides });
}

interface FakeState {
  teamStatus: Record<string, unknown>;
  memberships: Record<string, unknown>;
}

function fakeCollection(
  state: FakeState,
): AuthorizeTeamAccessCollection & { calls: { status: number; membership: number } } {
  const calls = { status: 0, membership: 0 };
  return {
    calls,
    async getTeamStatus(teamId) {
      calls.status += 1;
      return state.teamStatus[teamId];
    },
    async getMembership(uid, teamId) {
      calls.membership += 1;
      return state.memberships[`${uid}__${teamId}`];
    },
  };
}

describe("authorizeTeamAccess", () => {
  it("returns 'admin' for an app admin when the team is active", async () => {
    const collection = fakeCollection({
      teamStatus: { "team-1": "active" },
      memberships: {},
    });

    const result = await authorizeTeamAccess(adminIdentity(), "team-1", {
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: true, access: "admin" });
  });

  it("returns 'admin' for an app admin when the team is disabled (BR-3)", async () => {
    const collection = fakeCollection({
      teamStatus: { "team-1": "disabled" },
      memberships: {},
    });

    const result = await authorizeTeamAccess(adminIdentity(), "team-1", {
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: true, access: "admin" });
  });

  it("returns 'denied' for an app admin when the teamId does not exist", async () => {
    const collection = fakeCollection({ teamStatus: {}, memberships: {} });

    const result = await authorizeTeamAccess(adminIdentity(), "nonexistent-team", {
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: true, access: "denied" });
  });

  it("never checks membership for an app admin (short-circuits after the team-status check)", async () => {
    const collection = fakeCollection({
      teamStatus: { "team-1": "active" },
      memberships: {},
    });

    await authorizeTeamAccess(adminIdentity(), "team-1", {
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(collection.calls.membership).toBe(0);
  });

  it("returns 'member' for a non-admin with a valid membership on an active team", async () => {
    const collection = fakeCollection({
      teamStatus: { "team-1": "active" },
      memberships: { [`${MEMBER_UID}__team-1`]: { uid: MEMBER_UID, teamId: "team-1" } },
    });

    const result = await authorizeTeamAccess(identity(), "team-1", {
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: true, access: "member" });
  });

  it("returns 'member' for an existing member of a disabled team (BR-3)", async () => {
    const collection = fakeCollection({
      teamStatus: { "team-1": "disabled" },
      memberships: { [`${MEMBER_UID}__team-1`]: { uid: MEMBER_UID, teamId: "team-1" } },
    });

    const result = await authorizeTeamAccess(identity(), "team-1", {
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: true, access: "member" });
  });

  it("returns 'denied' for a non-admin with no membership on an active team", async () => {
    const collection = fakeCollection({
      teamStatus: { "team-1": "active" },
      memberships: {},
    });

    const result = await authorizeTeamAccess(identity(), "team-1", {
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: true, access: "denied" });
  });

  it("returns 'denied' for a non-admin with no membership on a disabled team (BR-16)", async () => {
    const collection = fakeCollection({
      teamStatus: { "team-1": "disabled" },
      memberships: {},
    });

    const result = await authorizeTeamAccess(identity(), "team-1", {
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: true, access: "denied" });
  });

  it("returns 'denied' for a non-admin when the teamId does not exist (BR-16)", async () => {
    const collection = fakeCollection({ teamStatus: {}, memberships: {} });

    const result = await authorizeTeamAccess(identity(), "nonexistent-team", {
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: true, access: "denied" });
  });

  it("fails closed to 'denied' when the team's status field is malformed/unrecognized, even for an app admin", async () => {
    const collection = fakeCollection({
      teamStatus: { "team-1": "archived" },
      memberships: {},
    });

    const memberResult = await authorizeTeamAccess(identity(), "team-1", {
      allowList: [ADMIN_EMAIL],
      collection,
    });
    const adminResult = await authorizeTeamAccess(adminIdentity(), "team-1", {
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(memberResult).toEqual({ ok: true, access: "denied" });
    expect(adminResult).toEqual({ ok: true, access: "denied" });
  });

  it("fails closed to 'denied' when the membership document exists but its uid/teamId don't match the caller (malformed/mismatched document)", async () => {
    const collection = fakeCollection({
      teamStatus: { "team-1": "active" },
      memberships: {
        [`${MEMBER_UID}__team-1`]: { uid: "someone-else", teamId: "team-1" },
      },
    });

    const result = await authorizeTeamAccess(identity(), "team-1", {
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: true, access: "denied" });
  });

  it("authorizes a user's memberships in two different teams independently", async () => {
    const collection = fakeCollection({
      teamStatus: { "team-1": "active", [OTHER_TEAM_ID]: "active" },
      memberships: { [`${MEMBER_UID}__team-1`]: { uid: MEMBER_UID, teamId: "team-1" } },
    });

    const teamOneResult = await authorizeTeamAccess(identity(), "team-1", {
      allowList: [ADMIN_EMAIL],
      collection,
    });
    const teamTwoResult = await authorizeTeamAccess(identity(), OTHER_TEAM_ID, {
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(teamOneResult).toEqual({ ok: true, access: "member" });
    expect(teamTwoResult).toEqual({ ok: true, access: "denied" });
  });

  it("denies access on the very next check after a membership is removed (BR-9)", async () => {
    const state: FakeState = {
      teamStatus: { "team-1": "active" },
      memberships: { [`${MEMBER_UID}__team-1`]: { uid: MEMBER_UID, teamId: "team-1" } },
    };
    const collection = fakeCollection(state);

    const before = await authorizeTeamAccess(identity(), "team-1", {
      allowList: [ADMIN_EMAIL],
      collection,
    });

    delete state.memberships[`${MEMBER_UID}__team-1`];

    const after = await authorizeTeamAccess(identity(), "team-1", {
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(before).toEqual({ ok: true, access: "member" });
    expect(after).toEqual({ ok: true, access: "denied" });
  });

  it("returns a read_failed result, never a denial or grant, when the team-status read rejects", async () => {
    const collection: AuthorizeTeamAccessCollection = {
      getTeamStatus: () => Promise.reject(new Error("simulated firestore outage")),
      getMembership: () => Promise.resolve({ uid: MEMBER_UID, teamId: "team-1" }),
    };

    const result = await authorizeTeamAccess(identity(), "team-1", {
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("returns a read_failed result, never a denial or grant, when the membership read rejects", async () => {
    const membershipCalls: string[] = [];
    const collection: AuthorizeTeamAccessCollection = {
      getTeamStatus: () => Promise.resolve("active"),
      getMembership: (uid, teamId) => {
        membershipCalls.push(`${uid}__${teamId}`);
        return Promise.reject(new Error("simulated firestore outage"));
      },
    };

    const result = await authorizeTeamAccess(identity(), "team-1", {
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "read_failed" });
    expect(membershipCalls).toEqual([`${MEMBER_UID}__team-1`]);
  });

  it("never leaks the underlying Firestore error's message into the result", async () => {
    const collection: AuthorizeTeamAccessCollection = {
      getTeamStatus: () =>
        Promise.reject(new Error("permission-denied: service account misconfigured")),
      getMembership: () => Promise.resolve(undefined),
    };

    const result = await authorizeTeamAccess(identity(), "team-1", {
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(JSON.stringify(result)).not.toContain("service account");
    expect(JSON.stringify(result)).not.toContain("permission-denied");
  });
});

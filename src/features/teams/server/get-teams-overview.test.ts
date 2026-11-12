import { toPersistedTeam } from "../domain/team-content-codec";
import { describe, expect, it, vi } from "vitest";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { ActiveTeamsCollection } from "./list-active-teams";
import type { ResolveInvitationsCollection, ResolveOneOutcome } from "./resolve-invitations";
import type { TeamsOverviewCollection } from "./get-teams-overview";
import { getTeamsOverview } from "./get-teams-overview";

const TOKEN = "valid-token";

function decoded(overrides: Partial<DecodedIdToken> = {}): DecodedIdToken {
  return {
    uid: "user-1",
    email: "dev@example.com",
    email_verified: true,
    ...overrides,
  } as DecodedIdToken;
}

function verifyToken(overrides: Partial<DecodedIdToken> = {}) {
  return vi.fn().mockResolvedValue(decoded(overrides));
}

function fakeActiveTeams(teams: Array<{ teamId: string; name: string }>): ActiveTeamsCollection {
  return {
    async listActive() {
      return teams.map((team) => ({ id: team.teamId, name: team.name, status: "active" }));
    },
  };
}

function noopResolveInvitations(): ResolveInvitationsCollection {
  return {
    async listRawForEmail() {
      return [];
    },
    async resolveOne() {
      return "no_longer_pending" as ResolveOneOutcome;
    },
  };
}

function fakeOverviewCollection(seed: {
  memberships?: unknown[];
  accessRequests?: unknown[];
  teams?: Record<string, unknown>;
}): TeamsOverviewCollection {
  return {
    async listMembershipsForUser() {
      return seed.memberships ?? [];
    },
    async listAccessRequestsForUser() {
      return seed.accessRequests ?? [];
    },
    async getTeam(teamId) {
      const doc = seed.teams?.[teamId];
      return typeof doc === "object" && doc !== null && typeof (doc as { name?: unknown }).name === "string"
        ? toPersistedTeam(teamId, doc as Record<string, unknown> & { name: string })
        : doc;
    },
  };
}

describe("getTeamsOverview", () => {
  it("rejects an unauthenticated caller and performs no Firestore reads", async () => {
    const activeTeamsCollection = fakeActiveTeams([{ teamId: "team-1", name: "Team One" }]);
    const listActiveSpy = vi.spyOn(activeTeamsCollection, "listActive");

    const result = await getTeamsOverview("", {
      verifyToken: vi.fn().mockRejectedValue(new Error("invalid")),
      activeTeamsCollection,
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(listActiveSpy).not.toHaveBeenCalled();
  });

  it("shows every active team with relationship 'none' for a verified user with no relationships", async () => {
    const result = await getTeamsOverview(TOKEN, {
      verifyToken: verifyToken(),
      activeTeamsCollection: fakeActiveTeams([
        { teamId: "team-1", name: "Team One" },
        { teamId: "team-2", name: "Team Two" },
      ]),
      resolveInvitationsCollection: noopResolveInvitations(),
      collection: fakeOverviewCollection({}),
      isSuperadmin: async () => false,
    });

    expect(result).toEqual({
      ok: true,
      teams: [
        { teamId: "team-1", name: "Team One", relationship: "none", isMember: false },
        { teamId: "team-2", name: "Team Two", relationship: "none", isMember: false },
      ],
    });
  });

  it("shows 'member' for a team the caller has a teamMemberships document for", async () => {
    const result = await getTeamsOverview(TOKEN, {
      verifyToken: verifyToken(),
      activeTeamsCollection: fakeActiveTeams([{ teamId: "team-1", name: "Team One" }]),
      resolveInvitationsCollection: noopResolveInvitations(),
      collection: fakeOverviewCollection({
        memberships: [{ uid: "user-1", teamId: "team-1" }],
      }),
      isSuperadmin: async () => false,
    });

    expect(result).toEqual({
      ok: true,
      teams: [{ teamId: "team-1", name: "Team One", relationship: "member", isMember: true }],
    });
  });

  it("shows 'admin' for every team when the caller is an app admin, regardless of membership", async () => {
    const result = await getTeamsOverview(TOKEN, {
      verifyToken: verifyToken({ uid: "admin-1", email: "admin@example.com" }),
      activeTeamsCollection: fakeActiveTeams([{ teamId: "team-1", name: "Team One" }]),
      resolveInvitationsCollection: noopResolveInvitations(),
      collection: fakeOverviewCollection({}),
      isSuperadmin: async (uid: string) => uid === "admin-1",
    });

    expect(result).toEqual({
      ok: true,
      teams: [{ teamId: "team-1", name: "Team One", relationship: "admin", isMember: false }],
    });
  });

  it("keeps relationship 'admin' for an app admin who is also a member, and flags the genuine membership", async () => {
    const result = await getTeamsOverview(TOKEN, {
      verifyToken: verifyToken({ uid: "admin-1", email: "admin@example.com" }),
      activeTeamsCollection: fakeActiveTeams([
        { teamId: "team-1", name: "Team One" },
        { teamId: "team-2", name: "Team Two" },
      ]),
      resolveInvitationsCollection: noopResolveInvitations(),
      collection: fakeOverviewCollection({
        memberships: [{ uid: "admin-1", teamId: "team-1" }],
      }),
      isSuperadmin: async (uid: string) => uid === "admin-1",
    });

    expect(result).toEqual({
      ok: true,
      teams: [
        { teamId: "team-1", name: "Team One", relationship: "admin", isMember: true },
        { teamId: "team-2", name: "Team Two", relationship: "admin", isMember: false },
      ],
    });
  });

  it("shows 'request_pending' for a team with a pending access request", async () => {
    const result = await getTeamsOverview(TOKEN, {
      verifyToken: verifyToken(),
      activeTeamsCollection: fakeActiveTeams([{ teamId: "team-1", name: "Team One" }]),
      resolveInvitationsCollection: noopResolveInvitations(),
      collection: fakeOverviewCollection({
        accessRequests: [{ uid: "user-1", teamId: "team-1", status: "pending" }],
      }),
      isSuperadmin: async () => false,
    });

    expect(result).toEqual({
      ok: true,
      teams: [{ teamId: "team-1", name: "Team One", relationship: "request_pending", isMember: false }],
    });
  });

  it("shows 'request_rejected' for a team with a rejected access request", async () => {
    const result = await getTeamsOverview(TOKEN, {
      verifyToken: verifyToken(),
      activeTeamsCollection: fakeActiveTeams([{ teamId: "team-1", name: "Team One" }]),
      resolveInvitationsCollection: noopResolveInvitations(),
      collection: fakeOverviewCollection({
        accessRequests: [{ uid: "user-1", teamId: "team-1", status: "rejected" }],
      }),
      isSuperadmin: async () => false,
    });

    expect(result).toEqual({
      ok: true,
      teams: [{ teamId: "team-1", name: "Team One", relationship: "request_rejected", isMember: false }],
    });
  });

  it("computes each team's relationship independently for a user with different states on different teams", async () => {
    const result = await getTeamsOverview(TOKEN, {
      verifyToken: verifyToken(),
      activeTeamsCollection: fakeActiveTeams([
        { teamId: "team-1", name: "Team One" },
        { teamId: "team-2", name: "Team Two" },
        { teamId: "team-3", name: "Team Three" },
      ]),
      resolveInvitationsCollection: noopResolveInvitations(),
      collection: fakeOverviewCollection({
        memberships: [{ uid: "user-1", teamId: "team-1" }],
        accessRequests: [{ uid: "user-1", teamId: "team-2", status: "pending" }],
      }),
      isSuperadmin: async () => false,
    });

    expect(result).toEqual({
      ok: true,
      teams: [
        { teamId: "team-1", name: "Team One", relationship: "member", isMember: true },
        { teamId: "team-2", name: "Team Two", relationship: "request_pending", isMember: false },
        { teamId: "team-3", name: "Team Three", relationship: "none", isMember: false },
      ],
    });
  });

  it("never lets membership in one team affect another team's relationship (cross-team isolation)", async () => {
    const result = await getTeamsOverview(TOKEN, {
      verifyToken: verifyToken(),
      activeTeamsCollection: fakeActiveTeams([
        { teamId: "team-1", name: "Team One" },
        { teamId: "team-2", name: "Team Two" },
      ]),
      resolveInvitationsCollection: noopResolveInvitations(),
      collection: fakeOverviewCollection({
        memberships: [{ uid: "user-1", teamId: "team-1" }],
      }),
      isSuperadmin: async () => false,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const teamTwo = result.teams.find((team) => team.teamId === "team-2");
      expect(teamTwo?.relationship).toBe("none");
    }
  });

  it("includes a disabled team the caller is a member of, alongside active teams", async () => {
    const result = await getTeamsOverview(TOKEN, {
      verifyToken: verifyToken(),
      activeTeamsCollection: fakeActiveTeams([{ teamId: "team-1", name: "Team One" }]),
      resolveInvitationsCollection: noopResolveInvitations(),
      collection: fakeOverviewCollection({
        memberships: [{ uid: "user-1", teamId: "team-2" }],
        teams: { "team-2": { name: "Team Two", status: "disabled" } },
      }),
      isSuperadmin: async () => false,
    });

    expect(result).toEqual({
      ok: true,
      teams: [
        { teamId: "team-1", name: "Team One", relationship: "none", isMember: false },
        { teamId: "team-2", name: "Team Two", relationship: "member", isMember: true },
      ],
    });
  });

  it("excludes a malformed membership document (missing teamId) without failing the whole read", async () => {
    const result = await getTeamsOverview(TOKEN, {
      verifyToken: verifyToken(),
      activeTeamsCollection: fakeActiveTeams([{ teamId: "team-1", name: "Team One" }]),
      resolveInvitationsCollection: noopResolveInvitations(),
      collection: fakeOverviewCollection({
        memberships: [{ uid: "user-1" }, null, "not-an-object"],
      }),
      isSuperadmin: async () => false,
    });

    expect(result).toEqual({
      ok: true,
      teams: [{ teamId: "team-1", name: "Team One", relationship: "none", isMember: false }],
    });
  });

  it("excludes an extra team whose document is malformed (invalid status) rather than trusting it", async () => {
    const result = await getTeamsOverview(TOKEN, {
      verifyToken: verifyToken(),
      activeTeamsCollection: fakeActiveTeams([]),
      resolveInvitationsCollection: noopResolveInvitations(),
      collection: fakeOverviewCollection({
        memberships: [{ uid: "user-1", teamId: "team-2" }],
        teams: { "team-2": { name: "Team Two", status: "not-a-real-status" } },
      }),
      isSuperadmin: async () => false,
    });

    expect(result).toEqual({ ok: true, teams: [] });
  });

  it("excludes an extra team that no longer exists (deleted teams document)", async () => {
    const result = await getTeamsOverview(TOKEN, {
      verifyToken: verifyToken(),
      activeTeamsCollection: fakeActiveTeams([]),
      resolveInvitationsCollection: noopResolveInvitations(),
      collection: fakeOverviewCollection({
        accessRequests: [{ uid: "user-1", teamId: "gone-team", status: "pending" }],
      }),
      isSuperadmin: async () => false,
    });

    expect(result).toEqual({ ok: true, teams: [] });
  });

  it("reports read_failed when the active-teams read fails", async () => {
    const result = await getTeamsOverview(TOKEN, {
      verifyToken: verifyToken(),
      activeTeamsCollection: {
        async listActive() {
          throw new Error("simulated firestore outage");
        },
      },
      resolveInvitationsCollection: noopResolveInvitations(),
      isSuperadmin: async () => false,
    });

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("reports read_failed when reading the caller's memberships fails", async () => {
    const result = await getTeamsOverview(TOKEN, {
      verifyToken: verifyToken(),
      activeTeamsCollection: fakeActiveTeams([{ teamId: "team-1", name: "Team One" }]),
      resolveInvitationsCollection: noopResolveInvitations(),
      collection: {
        async listMembershipsForUser() {
          throw new Error("simulated firestore outage");
        },
        async listAccessRequestsForUser() {
          return [];
        },
        async getTeam() {
          return undefined;
        },
      },
      isSuperadmin: async () => false,
    });

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("reports read_failed when pending-invitation resolution fails", async () => {
    const result = await getTeamsOverview(TOKEN, {
      verifyToken: verifyToken(),
      activeTeamsCollection: fakeActiveTeams([{ teamId: "team-1", name: "Team One" }]),
      resolveInvitationsCollection: {
        async listRawForEmail() {
          throw new Error("simulated firestore outage");
        },
        async resolveOne() {
          return "no_longer_pending" as ResolveOneOutcome;
        },
      },
      isSuperadmin: async () => false,
    });

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("reflects a pending invitation resolved into membership during this same load", async () => {
    const membershipsStore: unknown[] = [];

    const resolveInvitationsCollection: ResolveInvitationsCollection = {
      async listRawForEmail(email) {
        return email === "dev@example.com"
          ? [{ teamId: "team-1", email: "dev@example.com", status: "pending", invitedBy: "admin-1" }]
          : [];
      },
      async resolveOne({ teamId, uid }) {
        membershipsStore.push({ uid, teamId });
        return "membership_created";
      },
    };

    const result = await getTeamsOverview(TOKEN, {
      verifyToken: verifyToken(),
      activeTeamsCollection: fakeActiveTeams([{ teamId: "team-1", name: "Team One" }]),
      resolveInvitationsCollection,
      collection: {
        async listMembershipsForUser() {
          return membershipsStore;
        },
        async listAccessRequestsForUser() {
          return [];
        },
        async getTeam() {
          return undefined;
        },
      },
      isSuperadmin: async () => false,
    });

    expect(result).toEqual({
      ok: true,
      teams: [{ teamId: "team-1", name: "Team One", relationship: "member", isMember: true }],
    });
  });

  it("never includes member/invitation/request identity data in the overview DTO", async () => {
    const result = await getTeamsOverview(TOKEN, {
      verifyToken: verifyToken(),
      activeTeamsCollection: fakeActiveTeams([{ teamId: "team-1", name: "Team One" }]),
      resolveInvitationsCollection: noopResolveInvitations(),
      collection: fakeOverviewCollection({
        memberships: [{ uid: "user-1", teamId: "team-1" }],
      }),
      isSuperadmin: async () => false,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const entry of result.teams) {
        expect(Object.keys(entry).sort()).toEqual(["isMember", "name", "relationship", "teamId"]);
      }
      expect(JSON.stringify(result)).not.toContain("user-1");
      expect(JSON.stringify(result)).not.toContain("dev@example.com");
    }
  });
});

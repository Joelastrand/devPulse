import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { AuthorizeTeamAccessCollection } from "./authorize-team-access";
import type {
  CreateAccessRequestCollection,
  CreateAccessRequestTeamsCollection,
  CreateOrResetOutcome,
} from "./create-access-request";
import { createAccessRequest } from "./create-access-request";

const ADMIN_EMAIL = "admin@example.com";
const NOW = new Date("2026-09-01T00:00:00Z");

function identity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: "user-1", email: "dev@example.com", emailVerified: true, ...overrides };
}

function verifyTokenReturning(user: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: user.uid,
    email: user.email,
    email_verified: user.emailVerified,
  });
}

function fakeAuthCollection(state: {
  teamStatus: Record<string, unknown>;
  memberships?: Record<string, unknown>;
}): AuthorizeTeamAccessCollection {
  return {
    async getTeamStatus(teamId) {
      return state.teamStatus[teamId];
    },
    async getMembership(uid, teamId) {
      return state.memberships?.[`${uid}__${teamId}`];
    },
  };
}

function fakeTeams(statuses: Record<string, unknown>): CreateAccessRequestTeamsCollection {
  return { getStatus: vi.fn(async (teamId: string) => statuses[teamId]) };
}

/** Stateful fake reproducing the production transaction's re-check-then-write semantics. */
function fakeRequests(
  seed: Record<string, { teamId: string; uid: string; status: string }> = {},
): CreateAccessRequestCollection & {
  store: Record<string, { teamId: string; uid: string; status: string }>;
  calls: number;
} {
  const store = { ...seed };
  let calls = 0;
  return {
    store,
    get calls() {
      return calls;
    },
    async createOrReset({ uid, teamId, now }) {
      calls += 1;
      void now;
      const key = `${uid}__${teamId}`;
      const existing = store[key];
      if (existing && existing.status === "pending") {
        return "already_pending" satisfies CreateOrResetOutcome;
      }
      store[key] = { teamId, uid, status: "pending" };
      return "created" satisfies CreateOrResetOutcome;
    },
  };
}

const baseDeps = { verifyToken: verifyTokenReturning(identity()) };

describe("createAccessRequest", () => {
  it("creates a pending request for a verified non-member (BR-23)", async () => {
    const authCollection = fakeAuthCollection({ teamStatus: { "team-1": "active" } });
    const requests = fakeRequests();

    const result = await createAccessRequest("token", "team-1", {
      ...baseDeps,
      authorizeCollection: authCollection,
      teamsCollection: fakeTeams({ "team-1": "active" }),
      collection: requests,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, outcome: "created" });
    expect(requests.store["user-1__team-1"]).toEqual({
      teamId: "team-1",
      uid: "user-1",
      status: "pending",
    });
  });

  it("does not create a request for an existing member (BR-28)", async () => {
    const authCollection = fakeAuthCollection({
      teamStatus: { "team-1": "active" },
      memberships: { "user-1__team-1": { uid: "user-1", teamId: "team-1" } },
    });
    const requests = fakeRequests();

    const result = await createAccessRequest("token", "team-1", {
      ...baseDeps,
      authorizeCollection: authCollection,
      teamsCollection: fakeTeams({ "team-1": "active" }),
      collection: requests,
    });

    expect(result).toEqual({ ok: true, outcome: "already_authorized" });
    expect(requests.calls).toBe(0);
  });

  it("does not create a request for an app admin (BR-28)", async () => {
    const authCollection = fakeAuthCollection({ teamStatus: { "team-1": "active" } });
    const requests = fakeRequests();

    const result = await createAccessRequest("token", "team-1", {
      verifyToken: verifyTokenReturning(identity({ email: ADMIN_EMAIL })),
      allowList: [ADMIN_EMAIL],
      authorizeCollection: authCollection,
      teamsCollection: fakeTeams({ "team-1": "active" }),
      collection: requests,
    });

    expect(result).toEqual({ ok: true, outcome: "already_authorized" });
    expect(requests.calls).toBe(0);
  });

  it("is idempotent while a request is already pending (BR-24)", async () => {
    const authCollection = fakeAuthCollection({ teamStatus: { "team-1": "active" } });
    const requests = fakeRequests({
      "user-1__team-1": { teamId: "team-1", uid: "user-1", status: "pending" },
    });

    const result = await createAccessRequest("token", "team-1", {
      ...baseDeps,
      authorizeCollection: authCollection,
      teamsCollection: fakeTeams({ "team-1": "active" }),
      collection: requests,
    });

    expect(result).toEqual({ ok: true, outcome: "already_pending" });
  });

  it("resubmits (resets to pending) a previously rejected request (BR-25)", async () => {
    const authCollection = fakeAuthCollection({ teamStatus: { "team-1": "active" } });
    const requests = fakeRequests({
      "user-1__team-1": { teamId: "team-1", uid: "user-1", status: "rejected" },
    });

    const result = await createAccessRequest("token", "team-1", {
      ...baseDeps,
      authorizeCollection: authCollection,
      teamsCollection: fakeTeams({ "team-1": "active" }),
      collection: requests,
    });

    expect(result).toEqual({ ok: true, outcome: "created" });
    expect(requests.store["user-1__team-1"].status).toBe("pending");
  });

  it("resubmits a request whose resulting membership was later removed (BR-25)", async () => {
    // "approved" status but no current membership (removed) — authorizeTeamAccess
    // returns "denied", so the caller can resubmit.
    const authCollection = fakeAuthCollection({ teamStatus: { "team-1": "active" } });
    const requests = fakeRequests({
      "user-1__team-1": { teamId: "team-1", uid: "user-1", status: "approved" },
    });

    const result = await createAccessRequest("token", "team-1", {
      ...baseDeps,
      authorizeCollection: authCollection,
      teamsCollection: fakeTeams({ "team-1": "active" }),
      collection: requests,
    });

    expect(result).toEqual({ ok: true, outcome: "created" });
    expect(requests.store["user-1__team-1"].status).toBe("pending");
  });

  it("never overwrites a just-completed approval's status when membership was independently granted while the create call was in flight (no lost update)", async () => {
    const authCollection = fakeAuthCollection({ teamStatus: { "team-1": "active" } });
    // authorizeTeamAccess's own pre-check still sees "denied" (stale — it
    // ran before the concurrent approval committed); the transactional
    // createOrReset call itself is the one that must catch the now-granted
    // membership and refuse to reset the request back to "pending".
    const collection: CreateAccessRequestCollection = {
      createOrReset: vi.fn().mockResolvedValue("already_authorized" satisfies CreateOrResetOutcome),
    };

    const result = await createAccessRequest("token", "team-1", {
      ...baseDeps,
      authorizeCollection: authCollection,
      teamsCollection: fakeTeams({ "team-1": "active" }),
      collection,
      now: NOW,
    });

    expect(result).toEqual({ ok: true, outcome: "already_authorized" });
  });

  it("keeps request identity isolated per team (a pending request for one team never blocks another)", async () => {
    const authCollection = fakeAuthCollection({
      teamStatus: { "team-1": "active", "team-2": "active" },
    });
    const requests = fakeRequests({
      "user-1__team-1": { teamId: "team-1", uid: "user-1", status: "pending" },
    });

    const result = await createAccessRequest("token", "team-2", {
      ...baseDeps,
      authorizeCollection: authCollection,
      teamsCollection: fakeTeams({ "team-1": "active", "team-2": "active" }),
      collection: requests,
    });

    expect(result).toEqual({ ok: true, outcome: "created" });
    expect(requests.store["user-1__team-2"]).toEqual({
      teamId: "team-2",
      uid: "user-1",
      status: "pending",
    });
    // the other team's pending request is untouched
    expect(requests.store["user-1__team-1"].status).toBe("pending");
  });

  it("creates a request for a nonexistent teamId identically to an existing team with no relationship (no distinguishing signal)", async () => {
    const authCollection = fakeAuthCollection({ teamStatus: {} });
    const requests = fakeRequests();

    const result = await createAccessRequest("token", "nonexistent-team", {
      ...baseDeps,
      authorizeCollection: authCollection,
      teamsCollection: fakeTeams({}),
      collection: requests,
    });

    expect(result).toEqual({ ok: true, outcome: "created" });
  });

  it("proceeds identically for a malformed/unrecognized team status (fails closed toward no distinguishing signal, never a grant)", async () => {
    const authCollection = fakeAuthCollection({ teamStatus: { "team-1": "archived" } });
    const requests = fakeRequests();

    const result = await createAccessRequest("token", "team-1", {
      ...baseDeps,
      authorizeCollection: authCollection,
      teamsCollection: fakeTeams({ "team-1": "archived" }),
      collection: requests,
    });

    expect(result).toEqual({ ok: true, outcome: "created" });
  });

  it("rejects a request targeting a disabled team (SPEC edge case), creating nothing", async () => {
    const authCollection = fakeAuthCollection({ teamStatus: { "team-1": "disabled" } });
    const requests = fakeRequests();

    const result = await createAccessRequest("token", "team-1", {
      ...baseDeps,
      authorizeCollection: authCollection,
      teamsCollection: fakeTeams({ "team-1": "disabled" }),
      collection: requests,
    });

    expect(result).toEqual({ ok: false, error: "team_disabled" });
    expect(requests.calls).toBe(0);
  });

  it("does not reject an existing member/admin of a disabled team as team_disabled (already_authorized takes precedence)", async () => {
    const authCollection = fakeAuthCollection({
      teamStatus: { "team-1": "disabled" },
      memberships: { "user-1__team-1": { uid: "user-1", teamId: "team-1" } },
    });
    const teams = fakeTeams({ "team-1": "disabled" });
    const requests = fakeRequests();

    const result = await createAccessRequest("token", "team-1", {
      ...baseDeps,
      authorizeCollection: authCollection,
      teamsCollection: teams,
      collection: requests,
    });

    expect(result).toEqual({ ok: true, outcome: "already_authorized" });
    expect(teams.getStatus).not.toHaveBeenCalled();
  });

  it("rejects an unverified caller and creates nothing", async () => {
    const authCollection = fakeAuthCollection({ teamStatus: { "team-1": "active" } });
    const requests = fakeRequests();

    const result = await createAccessRequest("token", "team-1", {
      verifyToken: verifyTokenReturning(identity({ emailVerified: false })),
      authorizeCollection: authCollection,
      teamsCollection: fakeTeams({ "team-1": "active" }),
      collection: requests,
    });

    expect(result).toEqual({ ok: false, error: "unverified" });
    expect(requests.calls).toBe(0);
  });

  it("rejects an unauthenticated/invalid token and creates nothing", async () => {
    const requests = fakeRequests();

    const result = await createAccessRequest("bad-token", "team-1", {
      verifyToken: vi.fn().mockRejectedValue(new Error("revoked token")),
      authorizeCollection: fakeAuthCollection({ teamStatus: { "team-1": "active" } }),
      teamsCollection: fakeTeams({ "team-1": "active" }),
      collection: requests,
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(requests.calls).toBe(0);
  });

  it("reports a controlled failure, never a denial, when authorizeTeamAccess itself fails", async () => {
    const authCollection: AuthorizeTeamAccessCollection = {
      getTeamStatus: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
      getMembership: vi.fn(),
    };
    const requests = fakeRequests();

    const result = await createAccessRequest("token", "team-1", {
      ...baseDeps,
      authorizeCollection: authCollection,
      teamsCollection: fakeTeams({ "team-1": "active" }),
      collection: requests,
    });

    expect(result).toEqual({ ok: false, error: "read_failed" });
    expect(requests.calls).toBe(0);
  });

  it("reports a controlled failure when the team-status read fails", async () => {
    const authCollection = fakeAuthCollection({ teamStatus: { "team-1": "active" } });
    const teams: CreateAccessRequestTeamsCollection = {
      getStatus: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    const requests = fakeRequests();

    const result = await createAccessRequest("token", "team-1", {
      ...baseDeps,
      authorizeCollection: authCollection,
      teamsCollection: teams,
      collection: requests,
    });

    expect(result).toEqual({ ok: false, error: "read_failed" });
    expect(requests.calls).toBe(0);
  });

  it("reports a controlled failure, not partial success, when the request write fails", async () => {
    const authCollection = fakeAuthCollection({ teamStatus: { "team-1": "active" } });
    const requests: CreateAccessRequestCollection = {
      createOrReset: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await createAccessRequest("token", "team-1", {
      ...baseDeps,
      authorizeCollection: authCollection,
      teamsCollection: fakeTeams({ "team-1": "active" }),
      collection: requests,
    });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("never leaks the underlying Firestore error's message into the result", async () => {
    const authCollection: AuthorizeTeamAccessCollection = {
      getTeamStatus: vi
        .fn()
        .mockRejectedValue(new Error("permission-denied: service account misconfigured")),
      getMembership: vi.fn(),
    };

    const result = await createAccessRequest("token", "team-1", {
      ...baseDeps,
      authorizeCollection: authCollection,
      teamsCollection: fakeTeams({ "team-1": "active" }),
      collection: fakeRequests(),
    });

    expect(JSON.stringify(result)).not.toContain("service account");
    expect(JSON.stringify(result)).not.toContain("permission-denied");
  });

  it("never logs the token or identity for success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await createAccessRequest("token", "team-1", {
      ...baseDeps,
      authorizeCollection: fakeAuthCollection({ teamStatus: { "team-1": "active" } }),
      teamsCollection: fakeTeams({ "team-1": "active" }),
      collection: fakeRequests(),
      now: NOW,
    });

    const failingTeams: CreateAccessRequestTeamsCollection = {
      getStatus: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    await createAccessRequest("token", "team-1", {
      ...baseDeps,
      authorizeCollection: fakeAuthCollection({ teamStatus: { "team-1": "active" } }),
      teamsCollection: failingTeams,
      collection: fakeRequests(),
    });

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

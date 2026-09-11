import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "../../../lib/encryption/encryption";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { AuthorizeTeamAccessCollection } from "../../teams/server/authorize-team-access";
import type { GetTeamResultsCollection, ResultsQueryRecord } from "./get-team-results";
import { getTeamResults } from "./get-team-results";

const NOW = new Date("2026-09-05T12:00:00.000Z"); // 2026-W36 is the current (open) period.
const OPEN_PERIOD = "2026-W36";
const MOST_RECENT_CLOSED_PERIOD = "2026-W35";
const ADMIN_EMAIL = "admin@example.com";
const MEMBER_UID = "member-1";
const TEAM_A = "team-a";
const TEAM_B = "team-b";

function memberIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: MEMBER_UID, email: "dev@example.com", emailVerified: true, ...overrides };
}

function adminIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return memberIdentity({ email: ADMIN_EMAIL, uid: "admin-1", ...overrides });
}

function verifyTokenReturning(identity: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: identity.uid,
    email: identity.email,
    email_verified: identity.emailVerified,
  });
}

interface AuthState {
  teamStatus: Record<string, unknown>;
  memberships: Record<string, unknown>;
}

function fakeAuthCollection(state: AuthState): AuthorizeTeamAccessCollection {
  return {
    async getTeamStatus(teamId) {
      return state.teamStatus[teamId];
    },
    async getMembership(uid, teamId) {
      return state.memberships[`${uid}__${teamId}`];
    },
  };
}

function encryptedAnswers(answers: [number, number, number]) {
  return encrypt(JSON.stringify(answers));
}

function fakeResultsCollection(
  recordsByTeam: Record<string, ResultsQueryRecord[]> = {},
): GetTeamResultsCollection & {
  calls: Array<{ teamId: string; periods: readonly string[] }>;
} {
  const calls: Array<{ teamId: string; periods: readonly string[] }> = [];
  return {
    calls,
    async listForTeamAndPeriods(teamId, periods) {
      calls.push({ teamId, periods });
      const records = recordsByTeam[teamId] ?? [];
      return records.filter((record) => periods.includes(record.period));
    },
  };
}

function fiveValidRecordsFor(period: string): ResultsQueryRecord[] {
  return [
    [1, 2, 3],
    [2, 3, 4],
    [3, 4, 5],
    [4, 5, 1],
    [5, 1, 2],
  ].map((answers) => ({ period, ...encryptedAnswers(answers as [number, number, number]) }));
}

describe("getTeamResults", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects an invalid token before authorizing or reading any data", async () => {
    const authCollection = fakeAuthCollection({ teamStatus: {}, memberships: {} });
    const resultsCollection = fakeResultsCollection();
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await getTeamResults("bad-token", TEAM_A, {
      verifyToken,
      authCollection,
      collection: resultsCollection,
      now: NOW,
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(resultsCollection.calls).toHaveLength(0);
  });

  it("returns forbidden for a non-member, without reading survey data", async () => {
    const authCollection = fakeAuthCollection({
      teamStatus: { [TEAM_A]: "active" },
      memberships: {},
    });
    const resultsCollection = fakeResultsCollection();
    const verifyToken = verifyTokenReturning(memberIdentity());

    const result = await getTeamResults("token", TEAM_A, {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      authCollection,
      collection: resultsCollection,
      now: NOW,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(resultsCollection.calls).toHaveLength(0);
  });

  it("returns forbidden for a nonexistent teamId, without reading survey data, even for an app admin", async () => {
    const authCollection = fakeAuthCollection({ teamStatus: {}, memberships: {} });
    const resultsCollection = fakeResultsCollection();

    const memberResult = await getTeamResults("token", "nonexistent-team", {
      verifyToken: verifyTokenReturning(memberIdentity()),
      allowList: [ADMIN_EMAIL],
      authCollection,
      collection: resultsCollection,
      now: NOW,
    });
    const adminResult = await getTeamResults("token", "nonexistent-team", {
      verifyToken: verifyTokenReturning(adminIdentity()),
      allowList: [ADMIN_EMAIL],
      authCollection,
      collection: resultsCollection,
      now: NOW,
    });

    expect(memberResult).toEqual({ ok: false, error: "forbidden" });
    expect(adminResult).toEqual({ ok: false, error: "forbidden" });
    expect(resultsCollection.calls).toHaveLength(0);
  });

  it("denies a member of team A access to team B's results (cross-team denial)", async () => {
    const authCollection = fakeAuthCollection({
      teamStatus: { [TEAM_A]: "active", [TEAM_B]: "active" },
      memberships: { [`${MEMBER_UID}__${TEAM_A}`]: { uid: MEMBER_UID, teamId: TEAM_A } },
    });
    const resultsCollection = fakeResultsCollection();
    const verifyToken = verifyTokenReturning(memberIdentity());

    const result = await getTeamResults("token", TEAM_B, {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      authCollection,
      collection: resultsCollection,
      now: NOW,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(resultsCollection.calls).toHaveLength(0);
  });

  it("returns forbidden when authorization fails closed due to a malformed team status", async () => {
    const authCollection = fakeAuthCollection({
      teamStatus: { [TEAM_A]: "archived" }, // not a valid TeamStatus
      memberships: {},
    });
    const resultsCollection = fakeResultsCollection();

    const result = await getTeamResults("token", TEAM_A, {
      verifyToken: verifyTokenReturning(adminIdentity()),
      allowList: [ADMIN_EMAIL],
      authCollection,
      collection: resultsCollection,
      now: NOW,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(resultsCollection.calls).toHaveLength(0);
  });

  it("allows an existing member to read their own team's results", async () => {
    const authCollection = fakeAuthCollection({
      teamStatus: { [TEAM_A]: "active" },
      memberships: { [`${MEMBER_UID}__${TEAM_A}`]: { uid: MEMBER_UID, teamId: TEAM_A } },
    });
    const resultsCollection = fakeResultsCollection({
      [TEAM_A]: fiveValidRecordsFor(MOST_RECENT_CLOSED_PERIOD),
    });

    const result = await getTeamResults("token", TEAM_A, {
      verifyToken: verifyTokenReturning(memberIdentity()),
      allowList: [ADMIN_EMAIL],
      authCollection,
      collection: resultsCollection,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.teamId).toBe(TEAM_A);
    expect(result.current).toEqual({
      period: MOST_RECENT_CLOSED_PERIOD,
      status: "published",
      mean: { flow: 3, stress: 3, fun: 3 },
      count: 5,
    });
  });

  it("allows an app admin to read an existing team's results without being a member", async () => {
    const authCollection = fakeAuthCollection({
      teamStatus: { [TEAM_A]: "active" },
      memberships: {},
    });
    const resultsCollection = fakeResultsCollection({
      [TEAM_A]: fiveValidRecordsFor(MOST_RECENT_CLOSED_PERIOD),
    });

    const result = await getTeamResults("token", TEAM_A, {
      verifyToken: verifyTokenReturning(adminIdentity()),
      allowList: [ADMIN_EMAIL],
      authCollection,
      collection: resultsCollection,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.current.status).toBe("published");
  });

  it("still allows an existing member of a disabled team to read results (BR-3)", async () => {
    const authCollection = fakeAuthCollection({
      teamStatus: { [TEAM_A]: "disabled" },
      memberships: { [`${MEMBER_UID}__${TEAM_A}`]: { uid: MEMBER_UID, teamId: TEAM_A } },
    });
    const resultsCollection = fakeResultsCollection({
      [TEAM_A]: fiveValidRecordsFor(MOST_RECENT_CLOSED_PERIOD),
    });

    const result = await getTeamResults("token", TEAM_A, {
      verifyToken: verifyTokenReturning(memberIdentity()),
      allowList: [ADMIN_EMAIL],
      authCollection,
      collection: resultsCollection,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.current.status).toBe("published");
  });

  it("denies a non-member of a disabled team exactly like a non-member of an active team", async () => {
    const authCollection = fakeAuthCollection({
      teamStatus: { [TEAM_A]: "disabled" },
      memberships: {},
    });
    const resultsCollection = fakeResultsCollection();

    const result = await getTeamResults("token", TEAM_A, {
      verifyToken: verifyTokenReturning(memberIdentity()),
      allowList: [ADMIN_EMAIL],
      authCollection,
      collection: resultsCollection,
      now: NOW,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(resultsCollection.calls).toHaveLength(0);
  });

  it("denies access on the very next request after the caller's membership is removed", async () => {
    const state: AuthState = {
      teamStatus: { [TEAM_A]: "active" },
      memberships: { [`${MEMBER_UID}__${TEAM_A}`]: { uid: MEMBER_UID, teamId: TEAM_A } },
    };
    const authCollection = fakeAuthCollection(state);
    const resultsCollection = fakeResultsCollection({
      [TEAM_A]: fiveValidRecordsFor(MOST_RECENT_CLOSED_PERIOD),
    });
    const verifyToken = verifyTokenReturning(memberIdentity());

    const before = await getTeamResults("token", TEAM_A, {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      authCollection,
      collection: resultsCollection,
      now: NOW,
    });

    delete state.memberships[`${MEMBER_UID}__${TEAM_A}`];

    const after = await getTeamResults("token", TEAM_A, {
      verifyToken,
      allowList: [ADMIN_EMAIL],
      authCollection,
      collection: resultsCollection,
      now: NOW,
    });

    expect(before.ok).toBe(true);
    expect(after).toEqual({ ok: false, error: "forbidden" });
  });

  it("requests exactly the 12 preceding closed periods, never the open period", async () => {
    const authCollection = fakeAuthCollection({
      teamStatus: { [TEAM_A]: "active" },
      memberships: { [`${MEMBER_UID}__${TEAM_A}`]: { uid: MEMBER_UID, teamId: TEAM_A } },
    });
    const resultsCollection = fakeResultsCollection();

    await getTeamResults("token", TEAM_A, {
      verifyToken: verifyTokenReturning(memberIdentity()),
      allowList: [ADMIN_EMAIL],
      authCollection,
      collection: resultsCollection,
      now: NOW,
    });

    expect(resultsCollection.calls).toHaveLength(1);
    const requestedPeriods = resultsCollection.calls[0].periods;
    expect(requestedPeriods).toHaveLength(12);
    expect(requestedPeriods).not.toContain(OPEN_PERIOD);
    expect(requestedPeriods[requestedPeriods.length - 1]).toBe(MOST_RECENT_CLOSED_PERIOD);
    expect(resultsCollection.calls[0].teamId).toBe(TEAM_A);
  });

  it("marks a period with no responses as insufficient, never as an aggregate with a zero count", async () => {
    const authCollection = fakeAuthCollection({
      teamStatus: { [TEAM_A]: "active" },
      memberships: { [`${MEMBER_UID}__${TEAM_A}`]: { uid: MEMBER_UID, teamId: TEAM_A } },
    });
    const resultsCollection = fakeResultsCollection();

    const result = await getTeamResults("token", TEAM_A, {
      verifyToken: verifyTokenReturning(memberIdentity()),
      allowList: [ADMIN_EMAIL],
      authCollection,
      collection: resultsCollection,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.current).toEqual({ period: MOST_RECENT_CLOSED_PERIOD, status: "insufficient" });
    expect(result.trend.every((entry) => entry.status !== "not_available")).toBe(true);
  });

  it("never returns an aggregate/count/trend entry for the open period", async () => {
    const authCollection = fakeAuthCollection({
      teamStatus: { [TEAM_A]: "active" },
      memberships: { [`${MEMBER_UID}__${TEAM_A}`]: { uid: MEMBER_UID, teamId: TEAM_A } },
    });
    // Records for the OPEN period would never legitimately exist per Phase 1's
    // own invariant, but even if a stray one did, it must never surface here.
    const resultsCollection = fakeResultsCollection({
      [TEAM_A]: fiveValidRecordsFor(OPEN_PERIOD),
    });

    const result = await getTeamResults("token", TEAM_A, {
      verifyToken: verifyTokenReturning(memberIdentity()),
      allowList: [ADMIN_EMAIL],
      authCollection,
      collection: resultsCollection,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    const periodsInTrend = result.trend.map((entry) => entry.period);
    expect(periodsInTrend).not.toContain(OPEN_PERIOD);
  });

  it("reports a read failure as a failure result, not a partial/fabricated dashboard", async () => {
    const authCollection = fakeAuthCollection({
      teamStatus: { [TEAM_A]: "active" },
      memberships: { [`${MEMBER_UID}__${TEAM_A}`]: { uid: MEMBER_UID, teamId: TEAM_A } },
    });
    const resultsCollection: GetTeamResultsCollection = {
      listForTeamAndPeriods: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await getTeamResults("token", TEAM_A, {
      verifyToken: verifyTokenReturning(memberIdentity()),
      allowList: [ADMIN_EMAIL],
      authCollection,
      collection: resultsCollection,
      now: NOW,
    });

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("reports a read failure, never a denial or an aggregate, when the team-status authorization read rejects", async () => {
    const authCollection: AuthorizeTeamAccessCollection = {
      getTeamStatus: () => Promise.reject(new Error("simulated firestore outage")),
      getMembership: () => Promise.resolve({ uid: MEMBER_UID, teamId: TEAM_A }),
    };
    const resultsCollection = fakeResultsCollection({
      [TEAM_A]: fiveValidRecordsFor(MOST_RECENT_CLOSED_PERIOD),
    });

    const result = await getTeamResults("token", TEAM_A, {
      verifyToken: verifyTokenReturning(memberIdentity()),
      allowList: [ADMIN_EMAIL],
      authCollection,
      collection: resultsCollection,
      now: NOW,
    });

    expect(result).toEqual({ ok: false, error: "read_failed" });
    expect(resultsCollection.calls).toHaveLength(0);
  });

  it("reports a read failure, never a denial or an aggregate, when the membership authorization read rejects", async () => {
    const authCollection: AuthorizeTeamAccessCollection = {
      getTeamStatus: () => Promise.resolve("active"),
      getMembership: () => Promise.reject(new Error("simulated firestore outage")),
    };
    const resultsCollection = fakeResultsCollection({
      [TEAM_A]: fiveValidRecordsFor(MOST_RECENT_CLOSED_PERIOD),
    });

    const result = await getTeamResults("token", TEAM_A, {
      verifyToken: verifyTokenReturning(memberIdentity()),
      allowList: [ADMIN_EMAIL],
      authCollection,
      collection: resultsCollection,
      now: NOW,
    });

    expect(result).toEqual({ ok: false, error: "read_failed" });
    expect(resultsCollection.calls).toHaveLength(0);
  });

  it("never leaks the underlying authorization-read error's message into the result", async () => {
    const authCollection: AuthorizeTeamAccessCollection = {
      getTeamStatus: () =>
        Promise.reject(new Error("permission-denied: service account misconfigured")),
      getMembership: () => Promise.resolve(undefined),
    };

    const result = await getTeamResults("token", TEAM_A, {
      verifyToken: verifyTokenReturning(memberIdentity()),
      allowList: [ADMIN_EMAIL],
      authCollection,
      collection: fakeResultsCollection(),
      now: NOW,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("service account");
    expect(serialized).not.toContain("permission-denied");
  });

  it("never includes any raw/individual response content (ciphertext, iv) in the returned result", async () => {
    const authCollection = fakeAuthCollection({
      teamStatus: { [TEAM_A]: "active" },
      memberships: { [`${MEMBER_UID}__${TEAM_A}`]: { uid: MEMBER_UID, teamId: TEAM_A } },
    });
    const records = fiveValidRecordsFor(MOST_RECENT_CLOSED_PERIOD);
    const resultsCollection = fakeResultsCollection({ [TEAM_A]: records });

    const result = await getTeamResults("token", TEAM_A, {
      verifyToken: verifyTokenReturning(memberIdentity()),
      allowList: [ADMIN_EMAIL],
      authCollection,
      collection: resultsCollection,
      now: NOW,
    });

    const serialized = JSON.stringify(result);
    for (const record of records) {
      expect(serialized).not.toContain(record.ciphertext);
      expect(serialized).not.toContain(record.iv);
    }
  });

  it("never logs the token, identity, decrypted content, or read-failure detail", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const authCollection = fakeAuthCollection({
      teamStatus: { [TEAM_A]: "active" },
      memberships: { [`${MEMBER_UID}__${TEAM_A}`]: { uid: MEMBER_UID, teamId: TEAM_A } },
    });

    await getTeamResults("token", TEAM_A, {
      verifyToken: verifyTokenReturning(memberIdentity()),
      allowList: [ADMIN_EMAIL],
      authCollection,
      collection: fakeResultsCollection({ [TEAM_A]: fiveValidRecordsFor(MOST_RECENT_CLOSED_PERIOD) }),
      now: NOW,
    });

    const failingCollection: GetTeamResultsCollection = {
      listForTeamAndPeriods: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    await getTeamResults("token", TEAM_A, {
      verifyToken: verifyTokenReturning(memberIdentity()),
      allowList: [ADMIN_EMAIL],
      authCollection,
      collection: failingCollection,
      now: NOW,
    });

    const failingAuthCollection: AuthorizeTeamAccessCollection = {
      getTeamStatus: () => Promise.reject(new Error("simulated firestore outage")),
      getMembership: () => Promise.resolve(undefined),
    };
    await getTeamResults("token", TEAM_A, {
      verifyToken: verifyTokenReturning(memberIdentity()),
      allowList: [ADMIN_EMAIL],
      authCollection: failingAuthCollection,
      collection: fakeResultsCollection(),
      now: NOW,
    });

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

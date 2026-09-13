import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "../../../lib/encryption/encryption";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { AuthorizeTeamAccessCollection } from "../../teams/server/authorize-team-access";
import type {
  GetTeamSurveyResultsCollections,
  GetTeamSurveyResultsDeps,
  RawSurveyDoc,
  RawSurveyResponseDoc,
} from "./get-team-survey-results";
import { getTeamSurveyResults } from "./get-team-survey-results";

const NOW = new Date("2026-09-05T12:00:00.000Z");
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

function surveyDoc(id: string, overrides: Record<string, unknown> = {}): RawSurveyDoc {
  return {
    id,
    data: {
      teamId: TEAM_A,
      accessMode: "public",
      minimumResponses: 5,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      createdBy: "admin-1",
      ...overrides,
    },
  };
}

function encryptedAnswers(answers: [number, number, number]) {
  return encrypt(JSON.stringify(answers));
}

function nResponsesFor(surveyId: string, n: number, teamId: string = TEAM_A): RawSurveyResponseDoc[] {
  const shapes: [number, number, number][] = [
    [1, 2, 3],
    [2, 3, 4],
    [3, 4, 5],
    [4, 5, 1],
    [5, 1, 2],
    [1, 1, 1],
    [2, 2, 2],
    [3, 3, 3],
    [4, 4, 4],
    [5, 5, 5],
  ];
  return Array.from({ length: n }, (_, i) => ({
    surveyId,
    teamId,
    ...encryptedAnswers(shapes[i % shapes.length]),
  }));
}

/**
 * A single, otherwise-well-formed `surveyResponses` document whose own
 * `surveyId` matches a real survey but whose own `teamId` is wrong —
 * models corrupted/inconsistent persisted data, unreachable via any
 * current write path, but must never count toward that survey's
 * `minimumResponses` or contribute to its aggregate (post-review fix).
 */
function wrongTeamResponse(surveyId: string): RawSurveyResponseDoc {
  return { surveyId, teamId: TEAM_B, ...encryptedAnswers([5, 5, 5]) };
}

interface FakeCollectionsState {
  surveys: RawSurveyDoc[];
  responsesBySurveyId?: Record<string, RawSurveyResponseDoc[]>;
}

function fakeCollections(
  state: FakeCollectionsState,
): GetTeamSurveyResultsCollections & {
  backfillCalls: Array<{ surveyId: string; closedAt: Date }>;
  responsesQueryCalls: Array<readonly string[]>;
} {
  const backfillCalls: Array<{ surveyId: string; closedAt: Date }> = [];
  const responsesQueryCalls: Array<readonly string[]> = [];
  return {
    backfillCalls,
    responsesQueryCalls,
    async listRawSurveysForTeam() {
      return state.surveys;
    },
    async listResponsesForSurveyIds(surveyIds) {
      responsesQueryCalls.push(surveyIds);
      const all = Object.values(state.responsesBySurveyId ?? {}).flat();
      return all.filter((r) => surveyIds.includes(r.surveyId));
    },
    async backfillClosedAt(surveyId, closedAt) {
      backfillCalls.push({ surveyId, closedAt });
      // Mutate the in-memory survey doc so a second read observes the backfill.
      const doc = state.surveys.find((s) => s.id === surveyId);
      if (doc && typeof doc.data === "object" && doc.data !== null) {
        (doc.data as Record<string, unknown>).closedAt = closedAt;
      }
    },
  };
}

function baseDeps(overrides: Partial<GetTeamSurveyResultsDeps> = {}): GetTeamSurveyResultsDeps {
  return {
    verifyToken: verifyTokenReturning(memberIdentity()),
    allowList: [ADMIN_EMAIL],
    authCollection: fakeAuthCollection({
      teamStatus: { [TEAM_A]: "active" },
      memberships: { [`${MEMBER_UID}__${TEAM_A}`]: { uid: MEMBER_UID, teamId: TEAM_A } },
    }),
    collections: fakeCollections({ surveys: [] }),
    now: NOW,
    ...overrides,
  };
}

describe("getTeamSurveyResults", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects an invalid token before authorizing or reading any survey data", async () => {
    const collections = fakeCollections({ surveys: [surveyDoc("s1", { closedAt: NOW })] });
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await getTeamSurveyResults(
      "bad-token",
      TEAM_A,
      baseDeps({ verifyToken, collections }),
    );

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("rejects an unrelated (non-member, non-admin) caller before reading survey data", async () => {
    const collections = fakeCollections({ surveys: [surveyDoc("s1", { closedAt: NOW })] });
    const authCollection = fakeAuthCollection({ teamStatus: { [TEAM_A]: "active" }, memberships: {} });

    const result = await getTeamSurveyResults(
      "token",
      TEAM_A,
      baseDeps({
        verifyToken: verifyTokenReturning(memberIdentity({ uid: "stranger" })),
        authCollection,
        collections,
      }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("authorizes an actual team member the same as it authorizes an app admin", async () => {
    const collections = fakeCollections({
      surveys: [surveyDoc("s1", { closedAt: NOW })],
      responsesBySurveyId: { s1: nResponsesFor("s1", 5) },
    });
    const authCollection = fakeAuthCollection({
      teamStatus: { [TEAM_A]: "active" },
      memberships: { [`${MEMBER_UID}__${TEAM_A}`]: { uid: MEMBER_UID, teamId: TEAM_A } },
    });

    const memberResult = await getTeamSurveyResults(
      "token",
      TEAM_A,
      baseDeps({ verifyToken: verifyTokenReturning(memberIdentity()), authCollection, collections }),
    );
    const adminResult = await getTeamSurveyResults(
      "token",
      TEAM_A,
      baseDeps({ verifyToken: verifyTokenReturning(adminIdentity()), authCollection, collections }),
    );

    expect(memberResult).toEqual(adminResult);
  });

  it("never appears for a scheduled or open survey (BR-27)", async () => {
    const collections = fakeCollections({
      surveys: [surveyDoc("scheduled-1"), surveyDoc("open-1", { openedAt: NOW })],
    });

    const result = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));

    expect(result).toEqual({ ok: true, teamId: TEAM_A, results: [] });
  });

  it("publishes an aggregate at/above threshold and suppresses below it, for the survey's own minimumResponses", async () => {
    const collections = fakeCollections({
      surveys: [
        surveyDoc("below", { closedAt: new Date("2026-08-01T00:00:00Z"), minimumResponses: 5 }),
        surveyDoc("above", { closedAt: new Date("2026-08-02T00:00:00Z"), minimumResponses: 5 }),
      ],
      responsesBySurveyId: {
        below: nResponsesFor("below", 4),
        above: nResponsesFor("above", 5),
      },
    });

    const result = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const byId = new Map(result.results.map((r) => [r.surveyId, r]));
    expect(byId.get("below")).toEqual({
      surveyId: "below",
      date: new Date("2026-08-01T00:00:00Z"),
      minimumResponses: 5,
      status: "insufficient",
    });
    const above = byId.get("above");
    expect(above?.status).toBe("published");
    if (above?.status === "published") {
      expect(above.count).toBe(5);
    }
  });

  it("never exposes an exact count for a below-threshold survey, in any form", async () => {
    const collections = fakeCollections({
      surveys: [surveyDoc("s1", { closedAt: NOW, minimumResponses: 5 })],
      responsesBySurveyId: { s1: nResponsesFor("s1", 4) },
    });

    const result = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const entry = result.results[0];
    expect(entry).not.toHaveProperty("count");
    expect(entry).not.toHaveProperty("mean");
    expect(JSON.stringify(entry)).not.toContain("4");
  });

  describe("threshold matrix", () => {
    it("minimumResponses=3 — 2 responses suppressed, 3 published", async () => {
      const collections = fakeCollections({
        surveys: [
          surveyDoc("two", { closedAt: NOW, minimumResponses: 3 }),
          surveyDoc("three", { closedAt: NOW, minimumResponses: 3 }),
        ],
        responsesBySurveyId: {
          two: nResponsesFor("two", 2),
          three: nResponsesFor("three", 3),
        },
      });

      const result = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      const byId = new Map(result.results.map((r) => [r.surveyId, r.status]));
      expect(byId.get("two")).toBe("insufficient");
      expect(byId.get("three")).toBe("published");
    });

    it("minimumResponses=5 — 4 responses suppressed, 5 published", async () => {
      const collections = fakeCollections({
        surveys: [
          surveyDoc("four", { closedAt: NOW, minimumResponses: 5 }),
          surveyDoc("five", { closedAt: NOW, minimumResponses: 5 }),
        ],
        responsesBySurveyId: {
          four: nResponsesFor("four", 4),
          five: nResponsesFor("five", 5),
        },
      });

      const result = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      const byId = new Map(result.results.map((r) => [r.surveyId, r.status]));
      expect(byId.get("four")).toBe("insufficient");
      expect(byId.get("five")).toBe("published");
    });

    it("minimumResponses=10 — 9 responses suppressed, 10 published", async () => {
      const collections = fakeCollections({
        surveys: [
          surveyDoc("nine", { closedAt: NOW, minimumResponses: 10 }),
          surveyDoc("ten", { closedAt: NOW, minimumResponses: 10 }),
        ],
        responsesBySurveyId: {
          nine: nResponsesFor("nine", 9),
          ten: nResponsesFor("ten", 10),
        },
      });

      const result = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      const byId = new Map(result.results.map((r) => [r.surveyId, r.status]));
      expect(byId.get("nine")).toBe("insufficient");
      expect(byId.get("ten")).toBe("published");
    });
  });

  it("each survey independently uses its own threshold — no global threshold leaks into the decision", async () => {
    const collections = fakeCollections({
      surveys: [
        surveyDoc("low-threshold", { closedAt: new Date("2026-08-01T00:00:00Z"), minimumResponses: 3 }),
        surveyDoc("high-threshold", { closedAt: new Date("2026-08-02T00:00:00Z"), minimumResponses: 10 }),
      ],
      responsesBySurveyId: {
        // 4 responses: publishable for the 3-threshold survey, insufficient for the 10-threshold one.
        "low-threshold": nResponsesFor("low-threshold", 4),
        "high-threshold": nResponsesFor("high-threshold", 4),
      },
    });

    const result = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const byId = new Map(result.results.map((r) => [r.surveyId, r.status]));
    expect(byId.get("low-threshold")).toBe("published");
    expect(byId.get("high-threshold")).toBe("insufficient");
  });

  it("fails closed (excludes the survey) for a malformed/missing minimumResponses, never assuming 5", async () => {
    const collections = fakeCollections({
      surveys: [
        {
          id: "malformed",
          data: {
            teamId: TEAM_A,
            accessMode: "public",
            // minimumResponses missing entirely
            createdAt: new Date("2026-01-01T00:00:00Z"),
            createdBy: "admin-1",
            closedAt: NOW,
          },
        },
        surveyDoc("out-of-range", { closedAt: NOW, minimumResponses: 2 }),
        surveyDoc("valid", { closedAt: NOW, minimumResponses: 5 }),
      ],
      responsesBySurveyId: {
        malformed: nResponsesFor("malformed", 10),
        "out-of-range": nResponsesFor("out-of-range", 10),
        valid: nResponsesFor("valid", 5),
      },
    });

    const result = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.results.map((r) => r.surveyId)).toEqual(["valid"]);
  });

  it("app admin gets no threshold bypass — sees the same suppressed entry as an ordinary member", async () => {
    const collections = fakeCollections({
      surveys: [surveyDoc("s1", { closedAt: NOW, minimumResponses: 5 })],
      responsesBySurveyId: { s1: nResponsesFor("s1", 4) },
    });
    const authCollection = fakeAuthCollection({
      teamStatus: { [TEAM_A]: "active" },
      memberships: {},
    });

    const result = await getTeamSurveyResults(
      "token",
      TEAM_A,
      baseDeps({ verifyToken: verifyTokenReturning(adminIdentity()), authCollection, collections }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.results[0]).toEqual({
      surveyId: "s1",
      date: NOW,
      minimumResponses: 5,
      status: "insufficient",
    });
  });

  it("responses from another survey never contribute to this survey's aggregate", async () => {
    const collections = fakeCollections({
      surveys: [
        surveyDoc("survey-a", { closedAt: NOW, minimumResponses: 5 }),
        surveyDoc("survey-b", { closedAt: NOW, minimumResponses: 5 }),
      ],
      responsesBySurveyId: {
        "survey-a": nResponsesFor("survey-a", 2),
        "survey-b": nResponsesFor("survey-b", 3),
      },
    });

    const result = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const byId = new Map(result.results.map((r) => [r.surveyId, r.status]));
    // 2 + 3 = 5 would meet the threshold if pooled — proving no cross-survey pooling.
    expect(byId.get("survey-a")).toBe("insufficient");
    expect(byId.get("survey-b")).toBe("insufficient");
  });

  it("responses from another team never contribute — a cross-team survey document is excluded entirely", async () => {
    const collections = fakeCollections({
      surveys: [
        surveyDoc("own-survey", { closedAt: NOW, minimumResponses: 5 }),
        // Structurally valid but scoped to a different team than requested —
        // the query would normally exclude this; defense-in-depth excludes
        // it here too, even if it were ever returned.
        surveyDoc("other-team-survey", { teamId: TEAM_B, closedAt: NOW, minimumResponses: 3 }),
      ],
      responsesBySurveyId: {
        "own-survey": nResponsesFor("own-survey", 2),
        "other-team-survey": nResponsesFor("other-team-survey", 3),
      },
    });

    const result = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.results.map((r) => r.surveyId)).toEqual(["own-survey"]);
  });

  describe("response-level teamId cross-check (post-review fix)", () => {
    it("a response with a matching surveyId but a mismatched teamId never counts toward the threshold or the aggregate", async () => {
      // minimumResponses = 3: 2 genuinely same-team responses plus 1
      // wrong-team response sharing the same surveyId. Raw doc count is 3
      // (meets the threshold), but only 2 are actually eligible — without
      // the cross-check, the wrong-team response would decrypt cleanly
      // (encryption never encodes teamId) and be miscounted as valid,
      // incorrectly publishing the survey.
      const collections = fakeCollections({
        surveys: [surveyDoc("s1", { closedAt: NOW, minimumResponses: 3 })],
        responsesBySurveyId: {
          s1: [...nResponsesFor("s1", 2), wrongTeamResponse("s1")],
        },
      });

      const result = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.results[0]).toEqual({
        surveyId: "s1",
        date: NOW,
        minimumResponses: 3,
        status: "insufficient",
      });
    });

    it("threshold boundary: 4 same-team responses plus 1 wrong-team response stays insufficient at minimumResponses=5", async () => {
      const collections = fakeCollections({
        surveys: [surveyDoc("s1", { closedAt: NOW, minimumResponses: 5 })],
        responsesBySurveyId: {
          s1: [...nResponsesFor("s1", 4), wrongTeamResponse("s1")],
        },
      });

      const result = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.results[0].status).toBe("insufficient");
      expect(result.results[0]).not.toHaveProperty("count");
    });

    it("5 same-team responses plus 1 wrong-team response still publishes with count 5, never 6", async () => {
      const collections = fakeCollections({
        surveys: [surveyDoc("s1", { closedAt: NOW, minimumResponses: 5 })],
        responsesBySurveyId: {
          s1: [...nResponsesFor("s1", 5), wrongTeamResponse("s1")],
        },
      });

      const result = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      const entry = result.results[0];
      expect(entry.status).toBe("published");
      if (entry.status === "published") {
        expect(entry.count).toBe(5);
      }
    });

    it("excludes a structurally malformed response document (missing teamId) rather than counting or crashing", async () => {
      const collections: GetTeamSurveyResultsCollections = {
        async listRawSurveysForTeam() {
          return [surveyDoc("s1", { closedAt: NOW, minimumResponses: 3 })];
        },
        async listResponsesForSurveyIds() {
          return [
            ...nResponsesFor("s1", 2),
            // Missing `teamId` entirely — structurally malformed, must be
            // excluded exactly like a mismatched or undecryptable record.
            { surveyId: "s1", ...encryptedAnswers([1, 1, 1]) },
          ];
        },
        async backfillClosedAt() {},
      };

      const result = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.results[0].status).toBe("insufficient");
    });
  });

  it("backfills closedAt exactly once for an endAt-expired, never-explicitly-closed survey, and sorts/displays by it", async () => {
    const collections = fakeCollections({
      surveys: [surveyDoc("expired", { endAt: new Date("2026-08-10T00:00:00Z") })],
      responsesBySurveyId: { expired: nResponsesFor("expired", 5) },
    });

    const first = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("expected ok");
    expect(first.results[0].date).toEqual(new Date("2026-08-10T00:00:00Z"));
    expect(collections.backfillCalls).toEqual([
      { surveyId: "expired", closedAt: new Date("2026-08-10T00:00:00Z") },
    ]);

    // Second read: closedAt is now set on the underlying doc — no repeat backfill.
    const second = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("expected ok");
    expect(second.results[0].date).toEqual(new Date("2026-08-10T00:00:00Z"));
    expect(collections.backfillCalls).toHaveLength(1);
  });

  it("a backfill write failure never fails the overall read", async () => {
    const collections: GetTeamSurveyResultsCollections = {
      async listRawSurveysForTeam() {
        return [surveyDoc("expired", { endAt: new Date("2026-08-10T00:00:00Z") })];
      },
      async listResponsesForSurveyIds() {
        return nResponsesFor("expired", 5);
      },
      async backfillClosedAt() {
        throw new Error("simulated firestore outage");
      },
    };

    const result = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.results[0].date).toEqual(new Date("2026-08-10T00:00:00Z"));
  });

  it("orders multiple completed surveys chronologically by their own irregular dates, most recent 12 only", async () => {
    const surveys = Array.from({ length: 14 }, (_, i) =>
      surveyDoc(`s${i}`, { closedAt: new Date(2026, 0, i + 1) }),
    );
    const collections = fakeCollections({
      surveys,
      responsesBySurveyId: Object.fromEntries(
        surveys.map(({ id }) => [id, nResponsesFor(id, 5)]),
      ),
    });

    const result = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.results).toHaveLength(12);
    expect(result.results.map((r) => r.surveyId)).toEqual([
      "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13",
    ]);
    // Chronological ascending order.
    for (let i = 1; i < result.results.length; i += 1) {
      expect(result.results[i].date.getTime()).toBeGreaterThan(result.results[i - 1].date.getTime());
    }
  });

  it("deterministic ordering for two surveys closed at the identical instant", async () => {
    const collections = fakeCollections({
      surveys: [
        surveyDoc("survey-z", { closedAt: NOW, minimumResponses: 5 }),
        surveyDoc("survey-a", { closedAt: NOW, minimumResponses: 5 }),
      ],
    });

    const first = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));
    const second = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));

    expect(first).toEqual(second);
  });

  it("supports surveys separated by irregular cadences (3 weeks, then 6 weeks) with no synthetic gap entries", async () => {
    const collections = fakeCollections({
      surveys: [
        surveyDoc("three-weeks-apart-1", { closedAt: new Date("2026-01-01T00:00:00Z") }),
        surveyDoc("three-weeks-apart-2", { closedAt: new Date("2026-01-22T00:00:00Z") }),
        surveyDoc("six-weeks-later", { closedAt: new Date("2026-03-05T00:00:00Z") }),
      ],
    });

    const result = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.results.map((r) => r.surveyId)).toEqual([
      "three-weeks-apart-1",
      "three-weeks-apart-2",
      "six-weeks-later",
    ]);
  });

  it("a disabled team's already-closed survey results remain visible to its existing members/admins (BR-42)", async () => {
    const collections = fakeCollections({
      surveys: [surveyDoc("s1", { closedAt: NOW, minimumResponses: 5 })],
      responsesBySurveyId: { s1: nResponsesFor("s1", 5) },
    });
    const authCollection = fakeAuthCollection({
      teamStatus: { [TEAM_A]: "disabled" },
      memberships: { [`${MEMBER_UID}__${TEAM_A}`]: { uid: MEMBER_UID, teamId: TEAM_A } },
    });

    const result = await getTeamSurveyResults(
      "token",
      TEAM_A,
      baseDeps({ authCollection, collections }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.results[0].status).toBe("published");
  });

  it("never returns raw individual response content, createdBy, or participation-shaped data", async () => {
    const collections = fakeCollections({
      surveys: [surveyDoc("s1", { closedAt: NOW, minimumResponses: 5, createdBy: "admin-secret" })],
      responsesBySurveyId: { s1: nResponsesFor("s1", 5) },
    });

    const result = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const serialized = JSON.stringify(result.results);
    expect(serialized).not.toContain("admin-secret");
    for (const forbiddenField of ["ciphertext", "iv", "authTag", "keyVersion", "createdBy", "uid"]) {
      expect(result.results[0]).not.toHaveProperty(forbiddenField);
    }
  });

  it("reports read_failed, not a thrown error, when the survey query fails", async () => {
    const collections: GetTeamSurveyResultsCollections = {
      async listRawSurveysForTeam() {
        throw new Error("simulated firestore outage");
      },
      async listResponsesForSurveyIds() {
        return [];
      },
      async backfillClosedAt() {},
    };

    const result = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("reports read_failed when the responses query fails", async () => {
    const collections: GetTeamSurveyResultsCollections = {
      async listRawSurveysForTeam() {
        return [surveyDoc("s1", { closedAt: NOW })];
      },
      async listResponsesForSurveyIds() {
        throw new Error("simulated firestore outage");
      },
      async backfillClosedAt() {},
    };

    const result = await getTeamSurveyResults("token", TEAM_A, baseDeps({ collections }));

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });
});

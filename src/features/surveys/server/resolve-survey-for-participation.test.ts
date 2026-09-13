import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type {
  ResolveSurveyForParticipationCollections,
  ResolveSurveyForParticipationDeps,
} from "./resolve-survey-for-participation";
import { resolveSurveyForParticipation } from "./resolve-survey-for-participation";

const TEAM_ID = "team-42";
const OTHER_TEAM_ID = "team-99";
const SURVEY_ID = "survey-1";
const MEMBER_UID = "member-1";
const APP_ADMIN_EMAIL = "admin@example.com";
const NOW = new Date("2026-09-01T00:00:00Z");

function surveyDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    teamId: TEAM_ID,
    accessMode: "public",
    minimumResponses: 5,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    createdBy: "some-admin",
    ...overrides,
  };
}

function teamDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { status: "active", name: "Team Rocket", ...overrides };
}

function membershipDoc(uid: string, teamId: string): Record<string, unknown> {
  return { uid, teamId, createdAt: new Date("2026-08-01T00:00:00Z"), createdVia: "admin_direct", grantedBy: "admin" };
}

function identity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: MEMBER_UID, email: "dev@example.com", emailVerified: true, ...overrides };
}

function verifyTokenReturning(verified: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: verified.uid,
    email: verified.email,
    email_verified: verified.emailVerified,
  });
}

interface FakeState {
  surveys?: Record<string, unknown>;
  teams?: Record<string, unknown>;
  memberships?: Record<string, unknown>;
}

function fakeCollections(
  state: FakeState,
): ResolveSurveyForParticipationCollections & {
  calls: { survey: number; team: number; membership: number };
} {
  const calls = { survey: 0, team: 0, membership: 0 };
  return {
    calls,
    async getSurvey(surveyId) {
      calls.survey += 1;
      return state.surveys?.[surveyId];
    },
    async getTeam(teamId) {
      calls.team += 1;
      return state.teams?.[teamId];
    },
    async getMembership(uid, teamId) {
      calls.membership += 1;
      return state.memberships?.[`${uid}__${teamId}`];
    },
  };
}

function baseDeps(
  collections: ResolveSurveyForParticipationCollections,
  overrides: Partial<ResolveSurveyForParticipationDeps> = {},
): ResolveSurveyForParticipationDeps {
  return { now: NOW, collections, ...overrides };
}

describe("resolveSurveyForParticipation", () => {
  describe("general", () => {
    it("resolves a valid public open survey as answerable", async () => {
      const collections = fakeCollections({
        surveys: { [SURVEY_ID]: surveyDoc({ accessMode: "public", openedAt: new Date("2026-08-15T00:00:00Z") }) },
        teams: { [TEAM_ID]: teamDoc() },
      });

      const result = await resolveSurveyForParticipation(SURVEY_ID, undefined, baseDeps(collections));

      expect(result).toEqual({
        ok: true,
        status: "answerable",
        survey: { surveyId: SURVEY_ID, teamName: "Team Rocket" },
      });
    });

    it("resolves a valid authenticated open survey as answerable for an actual member", async () => {
      const collections = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({
            accessMode: "authenticated",
            openedAt: new Date("2026-08-15T00:00:00Z"),
          }),
        },
        teams: { [TEAM_ID]: teamDoc() },
        memberships: { [`${MEMBER_UID}__${TEAM_ID}`]: membershipDoc(MEMBER_UID, TEAM_ID) },
      });

      const result = await resolveSurveyForParticipation(
        SURVEY_ID,
        "token",
        baseDeps(collections, { verifyToken: verifyTokenReturning(identity()) }),
      );

      expect(result).toEqual({
        ok: true,
        status: "answerable",
        survey: { surveyId: SURVEY_ID, teamName: "Team Rocket" },
      });
    });

    it("is server-authoritative: an unknown surveyId never resolves to survey data", async () => {
      const collections = fakeCollections({});

      const result = await resolveSurveyForParticipation(SURVEY_ID, undefined, baseDeps(collections));

      expect(result).toEqual({ ok: true, status: "not_found" });
    });

    it("returns a minimal DTO with only surveyId/title/teamName", async () => {
      const collections = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({
            accessMode: "public",
            title: "Q3 pulse",
            openedAt: new Date("2026-08-15T00:00:00Z"),
            createdBy: "admin-abc",
          }),
        },
        teams: { [TEAM_ID]: teamDoc() },
      });

      const result = await resolveSurveyForParticipation(SURVEY_ID, undefined, baseDeps(collections));

      expect(result.ok).toBe(true);
      if (result.ok && result.status === "answerable") {
        expect(Object.keys(result.survey).sort()).toEqual(["surveyId", "teamName", "title"]);
        expect(result.survey.title).toBe("Q3 pulse");
      } else {
        throw new Error("expected answerable outcome");
      }
    });
  });

  describe("public mode", () => {
    it("does not require a token", async () => {
      const collections = fakeCollections({
        surveys: { [SURVEY_ID]: surveyDoc({ accessMode: "public" }) },
        teams: { [TEAM_ID]: teamDoc() },
      });

      const result = await resolveSurveyForParticipation(SURVEY_ID, undefined, baseDeps(collections));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.status).not.toBe("sign_in_required");
      }
    });

    it("does not require membership even when a token is supplied", async () => {
      const collections = fakeCollections({
        surveys: { [SURVEY_ID]: surveyDoc({ accessMode: "public", openedAt: new Date("2026-08-15T00:00:00Z") }) },
        teams: { [TEAM_ID]: teamDoc() },
      });

      const result = await resolveSurveyForParticipation(
        SURVEY_ID,
        "token",
        baseDeps(collections, { verifyToken: verifyTokenReturning(identity()) }),
      );

      expect(result).toEqual({
        ok: true,
        status: "answerable",
        survey: { surveyId: SURVEY_ID, teamName: "Team Rocket" },
      });
      expect(collections.calls.membership).toBe(0);
    });

    it("exposes only the approved safe metadata, never response counts/results/admin/member data", async () => {
      const collections = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({
            accessMode: "public",
            title: "Q3 pulse",
            openedAt: new Date("2026-08-15T00:00:00Z"),
            createdBy: "admin-abc",
          }),
        },
        teams: { [TEAM_ID]: teamDoc() },
      });

      const result = await resolveSurveyForParticipation(SURVEY_ID, undefined, baseDeps(collections));

      expect(result.ok).toBe(true);
      if (result.ok && result.status === "answerable") {
        expect(result.survey).not.toHaveProperty("createdBy");
        expect(result.survey).not.toHaveProperty("archivedAt");
        expect(result.survey).not.toHaveProperty("responseCount");
        expect(result.survey).not.toHaveProperty("teamSurveyState");
        expect(result.survey).not.toHaveProperty("members");
        expect(result.survey).not.toHaveProperty("accessMode");
      } else {
        throw new Error("expected answerable outcome");
      }
    });
  });

  describe("authenticated mode", () => {
    it("returns sign-in-required when signed out, revealing no title/team-name/lifecycle data", async () => {
      const collections = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({
            accessMode: "authenticated",
            title: "Secret survey",
            openedAt: new Date("2026-08-15T00:00:00Z"),
          }),
        },
        teams: { [TEAM_ID]: teamDoc() },
      });

      const result = await resolveSurveyForParticipation(SURVEY_ID, undefined, baseDeps(collections));

      expect(result).toEqual({ ok: true, status: "sign_in_required" });
      expect(Object.keys(result)).toEqual(["ok", "status"]);
      expect(collections.calls.team).toBe(0);
      expect(collections.calls.membership).toBe(0);
    });

    it("returns forbidden for a signed-in, actual non-member", async () => {
      const collections = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({ accessMode: "authenticated", openedAt: new Date("2026-08-15T00:00:00Z") }),
        },
        teams: { [TEAM_ID]: teamDoc() },
      });

      const result = await resolveSurveyForParticipation(
        SURVEY_ID,
        "token",
        baseDeps(collections, { verifyToken: verifyTokenReturning(identity()) }),
      );

      expect(result).toEqual({ ok: true, status: "forbidden" });
      expect(collections.calls.team).toBe(0);
    });

    it("is not eligible for an app admin without actual membership (BR-16)", async () => {
      const collections = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({ accessMode: "authenticated", openedAt: new Date("2026-08-15T00:00:00Z") }),
        },
        teams: { [TEAM_ID]: teamDoc() },
        memberships: {},
      });

      const result = await resolveSurveyForParticipation(
        SURVEY_ID,
        "token",
        baseDeps(collections, {
          verifyToken: verifyTokenReturning(identity({ email: APP_ADMIN_EMAIL })),
        }),
      );

      expect(result).toEqual({ ok: true, status: "forbidden" });
    });

    it("rejects wrong-team membership", async () => {
      const collections = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({ accessMode: "authenticated", openedAt: new Date("2026-08-15T00:00:00Z") }),
        },
        teams: { [TEAM_ID]: teamDoc() },
        memberships: { [`${MEMBER_UID}__${OTHER_TEAM_ID}`]: membershipDoc(MEMBER_UID, OTHER_TEAM_ID) },
      });

      const result = await resolveSurveyForParticipation(
        SURVEY_ID,
        "token",
        baseDeps(collections, { verifyToken: verifyTokenReturning(identity()) }),
      );

      expect(result).toEqual({ ok: true, status: "forbidden" });
    });

    it("cannot resolve Team B's survey as answerable using membership authorized only for Team A", async () => {
      const collections = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({
            teamId: OTHER_TEAM_ID,
            accessMode: "authenticated",
            openedAt: new Date("2026-08-15T00:00:00Z"),
          }),
        },
        teams: { [OTHER_TEAM_ID]: teamDoc() },
        memberships: { [`${MEMBER_UID}__${TEAM_ID}`]: membershipDoc(MEMBER_UID, TEAM_ID) },
      });

      const result = await resolveSurveyForParticipation(
        SURVEY_ID,
        "token",
        baseDeps(collections, { verifyToken: verifyTokenReturning(identity()) }),
      );

      expect(result).toEqual({ ok: true, status: "forbidden" });
    });

    it("treats a revoked/invalid token the same as signed-out", async () => {
      const collections = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({ accessMode: "authenticated", openedAt: new Date("2026-08-15T00:00:00Z") }),
        },
        teams: { [TEAM_ID]: teamDoc() },
      });

      const result = await resolveSurveyForParticipation(
        SURVEY_ID,
        "expired-token",
        baseDeps(collections, { verifyToken: vi.fn().mockRejectedValue(new Error("revoked")) }),
      );

      expect(result).toEqual({ ok: true, status: "sign_in_required" });
    });
  });

  describe("lifecycle", () => {
    it("resolves a scheduled survey as scheduled", async () => {
      const collections = fakeCollections({
        surveys: { [SURVEY_ID]: surveyDoc({ accessMode: "public" }) },
        teams: { [TEAM_ID]: teamDoc() },
      });

      const result = await resolveSurveyForParticipation(SURVEY_ID, undefined, baseDeps(collections));

      expect(result).toEqual({
        ok: true,
        status: "scheduled",
        survey: { surveyId: SURVEY_ID, teamName: "Team Rocket" },
      });
    });

    it("resolves an open survey as answerable", async () => {
      const collections = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({ accessMode: "public", openedAt: new Date("2026-08-15T00:00:00Z") }),
        },
        teams: { [TEAM_ID]: teamDoc() },
      });

      const result = await resolveSurveyForParticipation(SURVEY_ID, undefined, baseDeps(collections));

      expect(result.ok && result.status).toBe("answerable");
    });

    it("resolves a survey exactly at its endAt boundary as closed", async () => {
      const collections = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({
            accessMode: "public",
            openedAt: new Date("2026-08-15T00:00:00Z"),
            endAt: NOW,
          }),
        },
        teams: { [TEAM_ID]: teamDoc() },
      });

      const result = await resolveSurveyForParticipation(SURVEY_ID, undefined, baseDeps(collections));

      expect(result.ok && result.status).toBe("closed");
    });

    it("resolves a survey after its endAt has passed as closed, even though closedAt was never written", async () => {
      const collections = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({
            accessMode: "public",
            openedAt: new Date("2026-08-15T00:00:00Z"),
            endAt: new Date("2026-08-31T00:00:00Z"),
          }),
        },
        teams: { [TEAM_ID]: teamDoc() },
      });

      const result = await resolveSurveyForParticipation(SURVEY_ID, undefined, baseDeps(collections));

      expect(result.ok && result.status).toBe("closed");
    });

    it("resolves an explicitly closed survey as closed", async () => {
      const collections = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({
            accessMode: "public",
            openedAt: new Date("2026-08-15T00:00:00Z"),
            closedAt: new Date("2026-08-20T00:00:00Z"),
          }),
        },
        teams: { [TEAM_ID]: teamDoc() },
      });

      const result = await resolveSurveyForParticipation(SURVEY_ID, undefined, baseDeps(collections));

      expect(result.ok && result.status).toBe("closed");
    });

    it("resolves an archived-but-closed survey identically to a plain closed survey", async () => {
      const collections = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({
            accessMode: "public",
            openedAt: new Date("2026-08-15T00:00:00Z"),
            closedAt: new Date("2026-08-20T00:00:00Z"),
            archivedAt: new Date("2026-08-21T00:00:00Z"),
          }),
        },
        teams: { [TEAM_ID]: teamDoc() },
      });

      const result = await resolveSurveyForParticipation(SURVEY_ID, undefined, baseDeps(collections));

      expect(result.ok && result.status).toBe("closed");
      expect(result.ok && result.status === "closed" && result.survey).not.toHaveProperty("archivedAt");
    });
  });

  describe("team status", () => {
    it("resolves answerable when the owning team is active", async () => {
      const collections = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({ accessMode: "public", openedAt: new Date("2026-08-15T00:00:00Z") }),
        },
        teams: { [TEAM_ID]: teamDoc({ status: "active" }) },
      });

      const result = await resolveSurveyForParticipation(SURVEY_ID, undefined, baseDeps(collections));

      expect(result.ok && result.status).toBe("answerable");
    });

    it("never resolves as answerable when the owning team is disabled (public)", async () => {
      const collections = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({ accessMode: "public", openedAt: new Date("2026-08-15T00:00:00Z") }),
        },
        teams: { [TEAM_ID]: teamDoc({ status: "disabled" }) },
      });

      const result = await resolveSurveyForParticipation(SURVEY_ID, undefined, baseDeps(collections));

      expect(result).toEqual({
        ok: true,
        status: "closed",
        survey: { surveyId: SURVEY_ID, teamName: "Team Rocket" },
      });
    });

    it("never resolves as answerable when the owning team is disabled (authenticated, actual member)", async () => {
      const collections = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({ accessMode: "authenticated", openedAt: new Date("2026-08-15T00:00:00Z") }),
        },
        teams: { [TEAM_ID]: teamDoc({ status: "disabled" }) },
        memberships: { [`${MEMBER_UID}__${TEAM_ID}`]: membershipDoc(MEMBER_UID, TEAM_ID) },
      });

      const result = await resolveSurveyForParticipation(
        SURVEY_ID,
        "token",
        baseDeps(collections, { verifyToken: verifyTokenReturning(identity()) }),
      );

      expect(result.ok && result.status).toBe("closed");
    });

    it("fails closed to unavailable when the owning team document is missing", async () => {
      const collections = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({ accessMode: "public", openedAt: new Date("2026-08-15T00:00:00Z") }),
        },
        teams: {},
      });

      const result = await resolveSurveyForParticipation(SURVEY_ID, undefined, baseDeps(collections));

      expect(result).toEqual({
        ok: true,
        status: "closed",
        survey: { surveyId: SURVEY_ID },
      });
    });

    it("fails closed to unavailable when the owning team's status field is malformed", async () => {
      const collections = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({ accessMode: "public", openedAt: new Date("2026-08-15T00:00:00Z") }),
        },
        teams: { [TEAM_ID]: { status: "not-a-real-status", name: "Team Rocket" } },
      });

      const result = await resolveSurveyForParticipation(SURVEY_ID, undefined, baseDeps(collections));

      expect(result.ok && result.status).toBe("closed");
    });

    it("a disabled/missing team never surfaces as a distinguishable signal from a plain closed survey", async () => {
      const disabledTeam = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({ accessMode: "public", openedAt: new Date("2026-08-15T00:00:00Z") }),
        },
        teams: { [TEAM_ID]: teamDoc({ status: "disabled" }) },
      });
      const explicitlyClosed = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({
            accessMode: "public",
            openedAt: new Date("2026-08-15T00:00:00Z"),
            closedAt: new Date("2026-08-20T00:00:00Z"),
          }),
        },
        teams: { [TEAM_ID]: teamDoc({ status: "active" }) },
      });

      const disabledResult = await resolveSurveyForParticipation(SURVEY_ID, undefined, baseDeps(disabledTeam));
      const closedResult = await resolveSurveyForParticipation(SURVEY_ID, undefined, baseDeps(explicitlyClosed));

      expect(disabledResult.ok && disabledResult.status).toBe(closedResult.ok && closedResult.status);
    });
  });

  describe("persistence/read failure", () => {
    it("reports a controlled read_failed result on a survey read failure, without leaking the raw error", async () => {
      const collections: ResolveSurveyForParticipationCollections = {
        getSurvey: vi.fn().mockRejectedValue(new Error("ECONNRESET talking to Firestore")),
        getTeam: vi.fn(),
        getMembership: vi.fn(),
      };

      const result = await resolveSurveyForParticipation(SURVEY_ID, undefined, baseDeps(collections));

      expect(result).toEqual({ ok: false, error: "read_failed" });
    });

    it("reports a controlled read_failed result on a team read failure", async () => {
      const collections: ResolveSurveyForParticipationCollections = {
        getSurvey: vi.fn().mockResolvedValue(surveyDoc({ accessMode: "public" })),
        getTeam: vi.fn().mockRejectedValue(new Error("boom")),
        getMembership: vi.fn(),
      };

      const result = await resolveSurveyForParticipation(SURVEY_ID, undefined, baseDeps(collections));

      expect(result).toEqual({ ok: false, error: "read_failed" });
    });

    it("reports a controlled read_failed result on a membership read failure", async () => {
      const collections: ResolveSurveyForParticipationCollections = {
        getSurvey: vi.fn().mockResolvedValue(surveyDoc({ accessMode: "authenticated" })),
        getTeam: vi.fn(),
        getMembership: vi.fn().mockRejectedValue(new Error("boom")),
      };

      const result = await resolveSurveyForParticipation(
        SURVEY_ID,
        "token",
        baseDeps(collections, { verifyToken: verifyTokenReturning(identity()) }),
      );

      expect(result).toEqual({ ok: false, error: "read_failed" });
    });
  });

  describe("privacy", () => {
    it("never includes createdBy, internal coordination fields, response count, or respondent/member identity", async () => {
      const collections = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({
            accessMode: "authenticated",
            openedAt: new Date("2026-08-15T00:00:00Z"),
            createdBy: "admin-abc",
          }),
        },
        teams: { [TEAM_ID]: teamDoc() },
        memberships: { [`${MEMBER_UID}__${TEAM_ID}`]: membershipDoc(MEMBER_UID, TEAM_ID) },
      });

      const result = await resolveSurveyForParticipation(
        SURVEY_ID,
        "token",
        baseDeps(collections, { verifyToken: verifyTokenReturning(identity()) }),
      );

      expect(result.ok).toBe(true);
      if (result.ok && result.status === "answerable") {
        const serialized = JSON.stringify(result.survey);
        expect(serialized).not.toContain("admin-abc");
        expect(serialized).not.toContain(MEMBER_UID);
        expect(result.survey).not.toHaveProperty("createdBy");
        expect(result.survey).not.toHaveProperty("teamSurveyState");
      } else {
        throw new Error("expected answerable outcome");
      }
    });

    it("never leaks an APP_ADMIN_EMAILS-derived signal in a forbidden outcome", async () => {
      const collections = fakeCollections({
        surveys: {
          [SURVEY_ID]: surveyDoc({ accessMode: "authenticated", openedAt: new Date("2026-08-15T00:00:00Z") }),
        },
        teams: { [TEAM_ID]: teamDoc() },
      });

      const result = await resolveSurveyForParticipation(
        SURVEY_ID,
        "token",
        baseDeps(collections, {
          verifyToken: verifyTokenReturning(identity({ email: APP_ADMIN_EMAIL })),
        }),
      );

      expect(result).toEqual({ ok: true, status: "forbidden" });
      expect(JSON.stringify(result)).not.toContain(APP_ADMIN_EMAIL);
    });
  });
});

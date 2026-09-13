import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { AuthorizeTeamAccessCollection } from "../../teams/server/authorize-team-access";
import type { GetCurrentTeamSurveyCollections, GetCurrentTeamSurveyDeps, RawSurveyDoc } from "./get-current-team-survey";
import { getCurrentTeamSurvey } from "./get-current-team-survey";

const ADMIN_EMAIL = "admin@example.com";
const MEMBER_UID = "member-1";
const TEAM_ID = "team-42";
const NOW = new Date("2026-09-01T00:00:00Z");

function memberIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: MEMBER_UID, email: "dev@example.com", emailVerified: true, ...overrides };
}

function adminIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return memberIdentity({ email: ADMIN_EMAIL, ...overrides });
}

function verifyTokenReturning(identity: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: identity.uid,
    email: identity.email,
    email_verified: identity.emailVerified,
  });
}

function surveyDoc(id: string, overrides: Record<string, unknown> = {}): RawSurveyDoc {
  return {
    id,
    data: {
      teamId: TEAM_ID,
      accessMode: "public",
      minimumResponses: 5,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      createdBy: "some-admin",
      ...overrides,
    },
  };
}

interface AuthFakeState {
  teamStatus: Record<string, unknown>;
  memberships: Record<string, unknown>;
}

function fakeAuthCollection(
  state: AuthFakeState,
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

function fakeCollections(
  docs: RawSurveyDoc[],
  teamStatus: unknown = "active",
): GetCurrentTeamSurveyCollections & { calls: { list: number; status: number } } {
  const calls = { list: 0, status: 0 };
  return {
    calls,
    async listRawForTeam(teamId) {
      calls.list += 1;
      return docs.filter((doc) => (doc.data as Record<string, unknown>).teamId === teamId);
    },
    async getTeamStatus() {
      calls.status += 1;
      return teamStatus;
    },
  };
}

function baseDeps(overrides: Partial<GetCurrentTeamSurveyDeps> = {}): GetCurrentTeamSurveyDeps {
  return {
    now: NOW,
    verifyToken: verifyTokenReturning(memberIdentity()),
    allowList: [ADMIN_EMAIL],
    authCollection: fakeAuthCollection({
      teamStatus: { [TEAM_ID]: "active" },
      memberships: { [`${MEMBER_UID}__${TEAM_ID}`]: { uid: MEMBER_UID, teamId: TEAM_ID } },
    }),
    collections: fakeCollections([]),
    ...overrides,
  };
}

describe("getCurrentTeamSurvey", () => {
  describe("authorization", () => {
    it("rejects an invalid/missing token as unauthenticated, with zero queries", async () => {
      const authCollection = fakeAuthCollection({ teamStatus: {}, memberships: {} });
      const collections = fakeCollections([]);

      const result = await getCurrentTeamSurvey(
        "bad-token",
        TEAM_ID,
        baseDeps({
          verifyToken: vi.fn().mockRejectedValue(new Error("invalid")),
          authCollection,
          collections,
        }),
      );

      expect(result).toEqual({ ok: false, error: "unauthenticated" });
      expect(authCollection.calls.status).toBe(0);
      expect(collections.calls.list).toBe(0);
    });

    it("denies a non-member, non-admin caller as forbidden, with zero survey queries", async () => {
      const authCollection = fakeAuthCollection({
        teamStatus: { [TEAM_ID]: "active" },
        memberships: {},
      });
      const collections = fakeCollections([surveyDoc("survey-1", { openedAt: NOW })]);

      const result = await getCurrentTeamSurvey(
        "token",
        TEAM_ID,
        baseDeps({ authCollection, collections }),
      );

      expect(result).toEqual({ ok: false, error: "forbidden" });
      expect(collections.calls.list).toBe(0);
    });

    it("allows an app admin with no membership document (mirrors team-page viewing rules, not participation eligibility)", async () => {
      const collections = fakeCollections([
        surveyDoc("survey-1", { title: "Q3 pulse", openedAt: NOW }),
      ]);

      const result = await getCurrentTeamSurvey(
        "token",
        TEAM_ID,
        baseDeps({
          verifyToken: verifyTokenReturning(adminIdentity()),
          authCollection: fakeAuthCollection({
            teamStatus: { [TEAM_ID]: "active" },
            memberships: {},
          }),
          collections,
        }),
      );

      expect(result).toEqual({
        ok: true,
        survey: {
          surveyId: "survey-1",
          title: "Q3 pulse",
          accessMode: "public",
          lifecycle: "open",
        },
      });
    });

    it("maps an authorization read failure to read_failed, never a denial", async () => {
      const authCollection: AuthorizeTeamAccessCollection = {
        async getTeamStatus() {
          throw new Error("firestore down");
        },
        async getMembership() {
          return undefined;
        },
      };

      const result = await getCurrentTeamSurvey("token", TEAM_ID, baseDeps({ authCollection }));

      expect(result).toEqual({ ok: false, error: "read_failed" });
    });
  });

  describe("team disable semantics", () => {
    it("shows no current survey for a disabled team, even though a scheduled/open survey document still exists (BR-41), without querying surveys", async () => {
      const collections = fakeCollections(
        [surveyDoc("survey-1", { openedAt: NOW })],
        "disabled",
      );

      const result = await getCurrentTeamSurvey("token", TEAM_ID, baseDeps({ collections }));

      expect(result).toEqual({ ok: true, survey: null });
      expect(collections.calls.list).toBe(0);
    });

    it("fails closed to no current survey for a missing/malformed team-status read", async () => {
      const docs = [surveyDoc("survey-1", { openedAt: NOW })];
      const collections: GetCurrentTeamSurveyCollections = {
        async listRawForTeam(teamId) {
          return docs.filter((doc) => (doc.data as Record<string, unknown>).teamId === teamId);
        },
        // Firestore returns `undefined` for a missing document's field.
        async getTeamStatus() {
          return undefined;
        },
      };

      const result = await getCurrentTeamSurvey("token", TEAM_ID, baseDeps({ collections }));

      expect(result).toEqual({ ok: true, survey: null });
    });

    it("maps a team-status read failure to read_failed", async () => {
      const collections: GetCurrentTeamSurveyCollections = {
        async listRawForTeam() {
          return [];
        },
        async getTeamStatus() {
          throw new Error("firestore down");
        },
      };

      const result = await getCurrentTeamSurvey("token", TEAM_ID, baseDeps({ collections }));

      expect(result).toEqual({ ok: false, error: "read_failed" });
    });
  });

  describe("current-survey selection", () => {
    it("returns the empty state when no survey exists at all", async () => {
      const result = await getCurrentTeamSurvey("token", TEAM_ID, baseDeps());

      expect(result).toEqual({ ok: true, survey: null });
    });

    it("returns the empty state when every survey is closed", async () => {
      const collections = fakeCollections([
        surveyDoc("closed-1", { closedAt: NOW }),
        surveyDoc("expired-1", { openedAt: new Date("2026-08-01T00:00:00Z"), endAt: new Date("2026-08-15T00:00:00Z") }),
      ]);

      const result = await getCurrentTeamSurvey("token", TEAM_ID, baseDeps({ collections }));

      expect(result).toEqual({ ok: true, survey: null });
    });

    it("returns a scheduled survey", async () => {
      const collections = fakeCollections([surveyDoc("survey-1", { title: "Q3 pulse" })]);

      const result = await getCurrentTeamSurvey("token", TEAM_ID, baseDeps({ collections }));

      expect(result).toEqual({
        ok: true,
        survey: {
          surveyId: "survey-1",
          title: "Q3 pulse",
          accessMode: "public",
          lifecycle: "scheduled",
        },
      });
    });

    it("returns an open survey, including start/end when set", async () => {
      const collections = fakeCollections([
        surveyDoc("survey-1", {
          accessMode: "authenticated",
          openedAt: NOW,
          startAt: new Date("2026-08-01T00:00:00Z"),
          endAt: new Date("2026-10-01T00:00:00Z"),
        }),
      ]);

      const result = await getCurrentTeamSurvey("token", TEAM_ID, baseDeps({ collections }));

      expect(result).toEqual({
        ok: true,
        survey: {
          surveyId: "survey-1",
          accessMode: "authenticated",
          lifecycle: "open",
          startAt: new Date("2026-08-01T00:00:00Z"),
          endAt: new Date("2026-10-01T00:00:00Z"),
        },
      });
    });

    it("prefers a genuinely open survey over a scheduled one", async () => {
      const collections = fakeCollections([
        surveyDoc("scheduled-1", { startAt: new Date("2026-08-01T00:00:00Z") }),
        surveyDoc("open-1", { openedAt: NOW }),
      ]);

      const result = await getCurrentTeamSurvey("token", TEAM_ID, baseDeps({ collections }));

      expect(result.ok).toBe(true);
      expect((result as { survey: { surveyId: string } }).survey.surveyId).toBe("open-1");
    });

    it("among several scheduled surveys, picks the one with the earliest startAt", async () => {
      const collections = fakeCollections([
        surveyDoc("later", { startAt: new Date("2026-10-01T00:00:00Z") }),
        surveyDoc("sooner", { startAt: new Date("2026-09-15T00:00:00Z") }),
      ]);

      const result = await getCurrentTeamSurvey("token", TEAM_ID, baseDeps({ collections }));

      expect(result.ok).toBe(true);
      expect((result as { survey: { surveyId: string } }).survey.surveyId).toBe("sooner");
    });

    it("falls back to the earliest createdAt among scheduled surveys with no startAt", async () => {
      const collections = fakeCollections([
        surveyDoc("newer", { createdAt: new Date("2026-08-15T00:00:00Z") }),
        surveyDoc("older", { createdAt: new Date("2026-08-01T00:00:00Z") }),
      ]);

      const result = await getCurrentTeamSurvey("token", TEAM_ID, baseDeps({ collections }));

      expect(result.ok).toBe(true);
      expect((result as { survey: { surveyId: string } }).survey.surveyId).toBe("older");
    });

    it("deterministically picks among multiple genuinely-open surveys (defensive handling of corrupted state — BR-6 prevents this in valid state) by earliest openedAt, regardless of listing order", async () => {
      const earlyOpen = surveyDoc("early-open", { openedAt: new Date("2026-08-01T00:00:00Z") });
      const laterOpen = surveyDoc("later-open", { openedAt: new Date("2026-08-15T00:00:00Z") });

      const forward = await getCurrentTeamSurvey(
        "token",
        TEAM_ID,
        baseDeps({ collections: fakeCollections([earlyOpen, laterOpen]) }),
      );
      expect((forward as { survey: { surveyId: string } }).survey.surveyId).toBe("early-open");

      // Same two surveys, listing order reversed — the old `.find()`-based
      // selection returned whichever happened to be first in the array
      // (here, "later-open"); this must still resolve to "early-open".
      const reversed = await getCurrentTeamSurvey(
        "token",
        TEAM_ID,
        baseDeps({ collections: fakeCollections([laterOpen, earlyOpen]) }),
      );
      expect((reversed as { survey: { surveyId: string } }).survey.surveyId).toBe("early-open");
    });

    it("falls back to earliest createdAt, then surveyId, among multiple open surveys sharing the same openedAt", async () => {
      const collections = fakeCollections([
        surveyDoc("z-survey", { openedAt: NOW, createdAt: new Date("2026-01-01T00:00:00Z") }),
        surveyDoc("a-survey", { openedAt: NOW, createdAt: new Date("2026-01-01T00:00:00Z") }),
      ]);

      const result = await getCurrentTeamSurvey("token", TEAM_ID, baseDeps({ collections }));

      // Listed "z-survey" first — the old `.find()`-based selection would
      // have returned it; the surveyId tie-break must still pick "a-survey".
      expect((result as { survey: { surveyId: string } }).survey.surveyId).toBe("a-survey");
    });

    it("excludes a malformed survey document rather than throwing or fabricating a row", async () => {
      const collections = fakeCollections([
        { id: "malformed-1", data: { teamId: TEAM_ID } },
        surveyDoc("valid-1", { title: "Valid" }),
      ]);

      const result = await getCurrentTeamSurvey("token", TEAM_ID, baseDeps({ collections }));

      expect(result.ok).toBe(true);
      expect((result as { survey: { surveyId: string } }).survey.surveyId).toBe("valid-1");
    });

    it("maps a surveys-list read failure to read_failed", async () => {
      const collections: GetCurrentTeamSurveyCollections = {
        async listRawForTeam() {
          throw new Error("firestore down");
        },
        async getTeamStatus() {
          return "active";
        },
      };

      const result = await getCurrentTeamSurvey("token", TEAM_ID, baseDeps({ collections }));

      expect(result).toEqual({ ok: false, error: "read_failed" });
    });
  });

  describe("privacy", () => {
    it("never includes createdBy, archivedAt, or any teamSurveyState-shaped field", async () => {
      const collections = fakeCollections([
        surveyDoc("survey-1", {
          openedAt: NOW,
          createdBy: "admin-secret",
          archivedAt: undefined,
        }),
      ]);

      const result = await getCurrentTeamSurvey("token", TEAM_ID, baseDeps({ collections }));

      if (!result.ok || result.survey === null) {
        throw new Error("expected a current survey");
      }
      const survey = result.survey as unknown as Record<string, unknown>;
      expect(survey).not.toHaveProperty("createdBy");
      expect(survey).not.toHaveProperty("archivedAt");
      expect(survey).not.toHaveProperty("activeSurveyId");
      expect(Object.keys(survey).sort()).toEqual(["accessMode", "lifecycle", "surveyId"]);
    });

    it("never selects a structurally valid survey whose persisted teamId doesn't match the requested teamId, even when the read seam itself returns it unfiltered (defense-in-depth beyond query scoping)", async () => {
      // Simulates a read seam that does NOT actually scope by teamId (a
      // broken query, a reused/misconfigured collection abstraction) — the
      // production Firestore query does scope correctly, but this function
      // must not rely on that scoping as its only protection (mirrors
      // close-survey.ts/delete-or-archive-survey.ts's own explicit
      // survey.teamId === teamId cross-checks).
      const nonScopingCollections: GetCurrentTeamSurveyCollections = {
        async listRawForTeam() {
          return [
            surveyDoc("cross-team-survey", { teamId: "other-team", openedAt: NOW }),
            surveyDoc("same-team-survey", { openedAt: NOW }),
          ];
        },
        async getTeamStatus() {
          return "active";
        },
      };

      const result = await getCurrentTeamSurvey(
        "token",
        TEAM_ID,
        baseDeps({ collections: nonScopingCollections }),
      );

      // Without the explicit teamId cross-check, the tie-break's surveyId
      // fallback would pick "cross-team-survey" ('c' < 's'); it must instead
      // resolve to the genuinely-scoped survey, not fail the whole read.
      expect(result.ok).toBe(true);
      expect((result as { survey: { surveyId: string } }).survey.surveyId).toBe("same-team-survey");
    });

    it("returns the empty state, not a leaked survey, when every returned document belongs to another team", async () => {
      const nonScopingCollections: GetCurrentTeamSurveyCollections = {
        async listRawForTeam() {
          return [surveyDoc("other-team-survey", { teamId: "other-team", openedAt: NOW })];
        },
        async getTeamStatus() {
          return "active";
        },
      };

      const result = await getCurrentTeamSurvey(
        "token",
        TEAM_ID,
        baseDeps({ collections: nonScopingCollections }),
      );

      expect(result).toEqual({ ok: true, survey: null });
    });
  });
});

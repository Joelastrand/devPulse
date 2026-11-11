import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { DeleteOrArchiveSurveyDocSnapshot, SurveyDocStore } from "./delete-or-archive-survey";
import { deleteDraftSurvey, type DeleteDraftSurveyDeps } from "./delete-draft-survey";

const ADMIN_UID = "admin-1";
const MEMBER_UID = "member-1";
const TEAM_ID = "team-42";
const OTHER_TEAM_ID = "team-99";
const SURVEY_ID = "survey-1";
const isAdminUid = async (uid: string): Promise<boolean> => uid === ADMIN_UID;

const ADMIN_IDENTITY: VerifiedIdentity = { uid: ADMIN_UID, email: "admin@example.com", emailVerified: true };
const MEMBER_IDENTITY: VerifiedIdentity = { uid: MEMBER_UID, email: "member@example.com", emailVerified: true };

function verifyAs(identity: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({ uid: identity.uid, email: identity.email, email_verified: identity.emailVerified });
}

function draftData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    teamId: TEAM_ID,
    accessMode: "public",
    minimumResponses: 5,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    createdBy: ADMIN_UID,
    ...overrides,
  };
}

function fakeDocStore(data: Record<string, unknown> | undefined) {
  const deleted: string[] = [];
  const store: SurveyDocStore & { deleted: string[] } = {
    deleted,
    async get(): Promise<DeleteOrArchiveSurveyDocSnapshot> {
      return { exists: data !== undefined, data: () => data };
    },
    async delete(surveyId) {
      deleted.push(surveyId);
    },
    async setArchivedAt() {
      throw new Error("draft deletion must never archive");
    },
  };
  return store;
}

function deps(overrides: Partial<DeleteDraftSurveyDeps> = {}): DeleteDraftSurveyDeps {
  return {
    verifyToken: verifyAs(ADMIN_IDENTITY),
    isSuperadmin: isAdminUid,
    surveyDocs: fakeDocStore(draftData()),
    responses: { hasAnyResponses: async () => false },
    ...overrides,
  };
}

describe("deleteDraftSurvey", () => {
  it("deletes an unpublished survey with no responses", async () => {
    const surveyDocs = fakeDocStore(draftData());

    const result = await deleteDraftSurvey("token", TEAM_ID, SURVEY_ID, deps({ surveyDocs }));

    expect(result).toEqual({ ok: true, outcome: "deleted" });
    expect(surveyDocs.deleted).toEqual([SURVEY_ID]);
  });

  it("refuses a caller who is not an app admin, before reading the survey", async () => {
    const surveyDocs = fakeDocStore(draftData());
    const getSpy = vi.spyOn(surveyDocs, "get");

    const result = await deleteDraftSurvey(
      "token",
      TEAM_ID,
      SURVEY_ID,
      deps({ surveyDocs, verifyToken: verifyAs(MEMBER_IDENTITY) }),
    );

    expect(result.ok).toBe(false);
    expect(getSpy).not.toHaveBeenCalled();
    expect(surveyDocs.deleted).toEqual([]);
  });

  it("refuses a survey that has been opened, even with no responses", async () => {
    const surveyDocs = fakeDocStore(draftData({ openedAt: new Date("2026-08-15T00:00:00Z") }));

    const result = await deleteDraftSurvey("token", TEAM_ID, SURVEY_ID, deps({ surveyDocs }));

    expect(result).toEqual({ ok: false, error: "not_draft" });
    expect(surveyDocs.deleted).toEqual([]);
  });

  it("refuses an archived survey", async () => {
    const surveyDocs = fakeDocStore(draftData({ archivedAt: new Date("2026-09-01T00:00:00Z") }));

    const result = await deleteDraftSurvey("token", TEAM_ID, SURVEY_ID, deps({ surveyDocs }));

    expect(result).toEqual({ ok: false, error: "not_draft" });
    expect(surveyDocs.deleted).toEqual([]);
  });

  it("refuses a draft that has any stored response, so history is never removed", async () => {
    const surveyDocs = fakeDocStore(draftData());

    const result = await deleteDraftSurvey(
      "token",
      TEAM_ID,
      SURVEY_ID,
      deps({ surveyDocs, responses: { hasAnyResponses: async () => true } }),
    );

    expect(result).toEqual({ ok: false, error: "has_responses" });
    expect(surveyDocs.deleted).toEqual([]);
  });

  it("refuses a survey that belongs to another team's route", async () => {
    const surveyDocs = fakeDocStore(draftData({ teamId: OTHER_TEAM_ID }));

    const result = await deleteDraftSurvey("token", TEAM_ID, SURVEY_ID, deps({ surveyDocs }));

    expect(result).toEqual({ ok: false, error: "wrong_team" });
    expect(surveyDocs.deleted).toEqual([]);
  });

  it("returns survey_not_found for a missing document and deletes nothing", async () => {
    const surveyDocs = fakeDocStore(undefined);

    const result = await deleteDraftSurvey("token", TEAM_ID, SURVEY_ID, deps({ surveyDocs }));

    expect(result).toEqual({ ok: false, error: "survey_not_found" });
    expect(surveyDocs.deleted).toEqual([]);
  });

  it("fails closed without deleting when the response check cannot be completed", async () => {
    const surveyDocs = fakeDocStore(draftData());

    const result = await deleteDraftSurvey(
      "token",
      TEAM_ID,
      SURVEY_ID,
      deps({
        surveyDocs,
        responses: {
          hasAnyResponses: async () => {
            throw new Error("firestore down");
          },
        },
      }),
    );

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(surveyDocs.deleted).toEqual([]);
  });
});

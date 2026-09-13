import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type {
  DeleteOrArchiveSurveyDeps,
  DeleteOrArchiveSurveyDocSnapshot,
  SurveyDocStore,
  SurveyResponsesExistenceReader,
} from "./delete-or-archive-survey";
import { deleteOrArchiveSurvey } from "./delete-or-archive-survey";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_UID = "admin-1";
const TEAM_ID = "team-42";
const SURVEY_ID = "survey-1";
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

function surveyData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    teamId: TEAM_ID,
    accessMode: "public",
    minimumResponses: 5,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: ADMIN_UID,
    ...overrides,
  };
}

interface FakeSurveyDocStore extends SurveyDocStore {
  deletedIds: string[];
  archivedWrites: { surveyId: string; archivedAt: Date }[];
}

function fakeSurveyDocStore(data: Record<string, unknown> | undefined): FakeSurveyDocStore {
  const deletedIds: string[] = [];
  const archivedWrites: { surveyId: string; archivedAt: Date }[] = [];
  return {
    deletedIds,
    archivedWrites,
    async get(): Promise<DeleteOrArchiveSurveyDocSnapshot> {
      return { exists: data !== undefined, data: () => data };
    },
    async delete(surveyId) {
      deletedIds.push(surveyId);
    },
    async setArchivedAt(surveyId, archivedAt) {
      archivedWrites.push({ surveyId, archivedAt });
    },
  };
}

function fakeResponsesReader(hasResponses: boolean): SurveyResponsesExistenceReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    hasAnyResponses: vi.fn(async (surveyId: string) => {
      calls.push(surveyId);
      return hasResponses;
    }),
  };
}

function baseDeps(overrides: Partial<DeleteOrArchiveSurveyDeps> = {}): DeleteOrArchiveSurveyDeps {
  return {
    verifyToken: verifyTokenReturning(verifiedIdentity()),
    allowList: [ADMIN_EMAIL],
    surveyDocs: fakeSurveyDocStore(surveyData({ closedAt: new Date("2026-02-01T00:00:00Z") })),
    responses: fakeResponsesReader(false),
    now: NOW,
    ...overrides,
  };
}

describe("deleteOrArchiveSurvey", () => {
  it("deletes a closed survey with zero responses", async () => {
    const surveyDocs = fakeSurveyDocStore(surveyData({ closedAt: new Date("2026-02-01T00:00:00Z") }));
    const responses = fakeResponsesReader(false);

    const result = await deleteOrArchiveSurvey(
      "token",
      TEAM_ID,
      SURVEY_ID,
      baseDeps({ surveyDocs, responses }),
    );

    expect(result).toEqual({ ok: true, outcome: "deleted" });
    expect(surveyDocs.deletedIds).toEqual([SURVEY_ID]);
    expect(surveyDocs.archivedWrites).toHaveLength(0);
  });

  it("archives a closed survey that has one or more responses, never deleting it", async () => {
    const surveyDocs = fakeSurveyDocStore(surveyData({ closedAt: new Date("2026-02-01T00:00:00Z") }));
    const responses = fakeResponsesReader(true);

    const result = await deleteOrArchiveSurvey(
      "token",
      TEAM_ID,
      SURVEY_ID,
      baseDeps({ surveyDocs, responses }),
    );

    expect(result).toEqual({ ok: true, outcome: "archived" });
    expect(surveyDocs.archivedWrites).toEqual([{ surveyId: SURVEY_ID, archivedAt: NOW }]);
    expect(surveyDocs.deletedIds).toHaveLength(0);
  });

  it("is idempotent for an already-archived survey — no response-count read, no further write", async () => {
    const surveyDocs = fakeSurveyDocStore(
      surveyData({
        closedAt: new Date("2026-02-01T00:00:00Z"),
        archivedAt: new Date("2026-03-01T00:00:00Z"),
      }),
    );
    const responses = fakeResponsesReader(true);

    const result = await deleteOrArchiveSurvey(
      "token",
      TEAM_ID,
      SURVEY_ID,
      baseDeps({ surveyDocs, responses }),
    );

    expect(result).toEqual({ ok: true, outcome: "archived" });
    expect(responses.calls).toHaveLength(0);
    expect(surveyDocs.archivedWrites).toHaveLength(0);
    expect(surveyDocs.deletedIds).toHaveLength(0);
  });

  it("rejects a scheduled survey and never reads response count", async () => {
    const surveyDocs = fakeSurveyDocStore(surveyData());
    const responses = fakeResponsesReader(false);

    const result = await deleteOrArchiveSurvey(
      "token",
      TEAM_ID,
      SURVEY_ID,
      baseDeps({ surveyDocs, responses }),
    );

    expect(result).toEqual({ ok: false, error: "not_closed" });
    expect(responses.calls).toHaveLength(0);
    expect(surveyDocs.deletedIds).toHaveLength(0);
    expect(surveyDocs.archivedWrites).toHaveLength(0);
  });

  it("rejects an open survey and never reads response count", async () => {
    const surveyDocs = fakeSurveyDocStore(surveyData({ openedAt: new Date("2026-01-15T00:00:00Z") }));
    const responses = fakeResponsesReader(false);

    const result = await deleteOrArchiveSurvey(
      "token",
      TEAM_ID,
      SURVEY_ID,
      baseDeps({ surveyDocs, responses }),
    );

    expect(result).toEqual({ ok: false, error: "not_closed" });
    expect(responses.calls).toHaveLength(0);
  });

  it("rejects a survey belonging to a different team — never mutated through the wrong team's route", async () => {
    const surveyDocs = fakeSurveyDocStore(
      surveyData({ teamId: "other-team", closedAt: new Date("2026-02-01T00:00:00Z") }),
    );

    const result = await deleteOrArchiveSurvey("token", TEAM_ID, SURVEY_ID, baseDeps({ surveyDocs }));

    expect(result).toEqual({ ok: false, error: "wrong_team" });
    expect(surveyDocs.deletedIds).toHaveLength(0);
    expect(surveyDocs.archivedWrites).toHaveLength(0);
  });

  it("rejects a nonexistent survey", async () => {
    const surveyDocs = fakeSurveyDocStore(undefined);

    const result = await deleteOrArchiveSurvey("token", TEAM_ID, SURVEY_ID, baseDeps({ surveyDocs }));

    expect(result).toEqual({ ok: false, error: "survey_not_found" });
  });

  it("fails closed on a malformed survey document", async () => {
    const surveyDocs = fakeSurveyDocStore({ teamId: TEAM_ID }); // missing accessMode/createdAt/createdBy

    const result = await deleteOrArchiveSurvey("token", TEAM_ID, SURVEY_ID, baseDeps({ surveyDocs }));

    expect(result).toEqual({ ok: false, error: "survey_not_found" });
  });

  it("rejects an unauthenticated caller and reads nothing", async () => {
    const surveyDocs = fakeSurveyDocStore(surveyData({ closedAt: new Date("2026-02-01T00:00:00Z") }));
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await deleteOrArchiveSurvey(
      "bad-token",
      TEAM_ID,
      SURVEY_ID,
      baseDeps({ surveyDocs, verifyToken }),
    );

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(surveyDocs.deletedIds).toHaveLength(0);
    expect(surveyDocs.archivedWrites).toHaveLength(0);
  });

  it("rejects a non-admin caller and reads nothing", async () => {
    const surveyDocs = fakeSurveyDocStore(surveyData({ closedAt: new Date("2026-02-01T00:00:00Z") }));
    const verifyToken = verifyTokenReturning(verifiedIdentity({ email: "dev@example.com" }));

    const result = await deleteOrArchiveSurvey(
      "token",
      TEAM_ID,
      SURVEY_ID,
      baseDeps({ surveyDocs, verifyToken }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(surveyDocs.deletedIds).toHaveLength(0);
  });

  it("reports a controlled failure when reading the survey fails", async () => {
    const surveyDocs: SurveyDocStore = {
      get: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
      delete: vi.fn(),
      setArchivedAt: vi.fn(),
    };

    const result = await deleteOrArchiveSurvey("token", TEAM_ID, SURVEY_ID, baseDeps({ surveyDocs }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("reports a controlled failure when reading response existence fails", async () => {
    const surveyDocs = fakeSurveyDocStore(surveyData({ closedAt: new Date("2026-02-01T00:00:00Z") }));
    const responses: SurveyResponsesExistenceReader = {
      hasAnyResponses: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await deleteOrArchiveSurvey(
      "token",
      TEAM_ID,
      SURVEY_ID,
      baseDeps({ surveyDocs, responses }),
    );

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(surveyDocs.deletedIds).toHaveLength(0);
    expect(surveyDocs.archivedWrites).toHaveLength(0);
  });

  it("reports a controlled failure, not partial success, when the delete write fails", async () => {
    const surveyDocs: SurveyDocStore = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => surveyData({ closedAt: new Date("2026-02-01T00:00:00Z") }),
      }),
      delete: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
      setArchivedAt: vi.fn(),
    };

    const result = await deleteOrArchiveSurvey(
      "token",
      TEAM_ID,
      SURVEY_ID,
      baseDeps({ surveyDocs, responses: fakeResponsesReader(false) }),
    );

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("reports a controlled failure, not partial success, when the archive write fails", async () => {
    const surveyDocs: SurveyDocStore = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => surveyData({ closedAt: new Date("2026-02-01T00:00:00Z") }),
      }),
      delete: vi.fn(),
      setArchivedAt: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await deleteOrArchiveSurvey(
      "token",
      TEAM_ID,
      SURVEY_ID,
      baseDeps({ surveyDocs, responses: fakeResponsesReader(true) }),
    );

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("never logs on any path", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await deleteOrArchiveSurvey("token", TEAM_ID, SURVEY_ID, baseDeps());

    const failingSurveyDocs: SurveyDocStore = {
      get: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
      delete: vi.fn(),
      setArchivedAt: vi.fn(),
    };
    await deleteOrArchiveSurvey("token", TEAM_ID, SURVEY_ID, baseDeps({ surveyDocs: failingSurveyDocs }));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

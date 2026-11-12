import { openSurveyDocument, toPersistedSurvey } from "./survey-content-codec";
import { persistedSurveyFixture, stubSurveyEncryptionKey } from "./survey-test-fixtures";
stubSurveyEncryptionKey();
import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import { getBuiltInTemplate } from "../domain/templates";
import { CONFIGURABLE_QUESTION_SET_VERSION } from "../domain/survey";
import { encodeResponsePayload } from "../domain/response-payload";
import { duplicateSurvey, type DuplicateSurveyDeps } from "./duplicate-survey";
import { getSurveyQuestionResults, type GetSurveyQuestionResultsDeps } from "./get-survey-question-results";
import { updateSurveyDraft, type SurveyDraftStore, type UpdateSurveyDraftDeps } from "./update-survey-draft";
import type { CreateSurveyDeps, SurveysCollection, SurveyRecord, TeamStatusReader } from "./create-survey";

const ADMIN_UID = "admin-1";
const MEMBER_UID = "member-1";
const TEAM_ID = "team-42";
const OTHER_TEAM_ID = "team-99";
const SURVEY_ID = "survey-1";
const NOW = new Date("2026-09-01T00:00:00Z");
const TEAM_PULSE = getBuiltInTemplate("team-pulse").questions;

const ADMIN_TOKEN_IDENTITY: VerifiedIdentity = { uid: ADMIN_UID, email: "admin@example.com", emailVerified: true };
const MEMBER_IDENTITY: VerifiedIdentity = { uid: MEMBER_UID, email: "member@example.com", emailVerified: true };

function verifyAs(identity: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({ uid: identity.uid, email: identity.email, email_verified: identity.emailVerified });
}

const isAdmin = async (uid: string) => uid === ADMIN_UID;

function surveyDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    teamId: TEAM_ID,
    accessMode: "public",
    minimumResponses: 5,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    createdBy: ADMIN_UID,
    ...overrides,
  };
}

function fakeDraftStore(initial: Record<string, unknown>): SurveyDraftStore & { docs: Map<string, unknown> } {
  // Stored documents are sealed, as in production: the store opens them before `mutate` and seals the result on write.
  const docs = new Map<string, unknown>(
    Object.entries(initial).map(([id, doc]) => [id, persistedSurveyFixture(id, doc as Record<string, unknown>)]),
  );
  return {
    docs,
    runUpdate: vi.fn(async (surveyId, _actorUid, mutate) => {
      const outcome = mutate(docs.get(surveyId));
      if (!outcome.ok) {
        return outcome;
      }
      docs.set(surveyId, toPersistedSurvey(surveyId, outcome.document));
      return { ok: true as const };
    }),
  };
}

/** The stored document, opened the way the production read path opens it. */
function openedStored(store: { docs: Map<string, unknown> }): Record<string, unknown> {
  return openSurveyDocument(SURVEY_ID, store.docs.get(SURVEY_ID)) as Record<string, unknown>;
}

function updateDeps(store: SurveyDraftStore, overrides: Partial<UpdateSurveyDraftDeps> = {}): UpdateSurveyDraftDeps {
  return { verifyToken: verifyAs(ADMIN_TOKEN_IDENTITY), isSuperadmin: isAdmin, store, now: NOW, ...overrides };
}

const VALID_PATCH = {
  title: "Oktoberpuls",
  description: "Kort om hvordan uken har vært.",
  questions: [
    { id: "energy", type: "rating", prompt: "Energi", required: true },
    { id: "note", type: "free_text", prompt: "Kommentar", required: false, maxLength: 200 },
  ],
};

describe("updateSurveyDraft", () => {
  it("saves title, description and questions for an unpublished draft, upgrading a legacy survey", async () => {
    const store = fakeDraftStore({ [SURVEY_ID]: surveyDoc({ title: "Gammel" }) });

    const result = await updateSurveyDraft("token", TEAM_ID, SURVEY_ID, VALID_PATCH, updateDeps(store));

    expect(result).toEqual({ ok: true });
    const saved = openedStored(store);
    expect(saved.title).toBe("Oktoberpuls");
    expect(saved.description).toBe("Kort om hvordan uken har vært.");
    expect(saved.questionSetVersion).toBe(CONFIGURABLE_QUESTION_SET_VERSION);
    expect((saved.questions as unknown[]).length).toBe(2);
    // Access mode and threshold are untouched.
    expect(saved.accessMode).toBe("public");
    expect(saved.minimumResponses).toBe(5);
  });

  it("clears an optional field when it is sent as null", async () => {
    const store = fakeDraftStore({ [SURVEY_ID]: surveyDoc({ title: "Ja", description: "Tekst" }) });

    await updateSurveyDraft("token", TEAM_ID, SURVEY_ID, { title: null, description: null }, updateDeps(store));

    const saved = openedStored(store);
    expect(saved).not.toHaveProperty("title");
    expect(saved).not.toHaveProperty("description");
  });

  it("refuses to change questions of an opened survey and leaves the stored document untouched", async () => {
    const original = surveyDoc({ openedAt: new Date("2026-08-15T00:00:00Z"), questions: TEAM_PULSE, questionSetVersion: 2 });
    const store = fakeDraftStore({ [SURVEY_ID]: original });

    const result = await updateSurveyDraft("token", TEAM_ID, SURVEY_ID, VALID_PATCH, updateDeps(store));

    expect(result).toEqual({ ok: false, error: "not_editable" });
    expect(openedStored(store)).toEqual(original);
  });

  it("updates only title and description of a published survey and keeps its questions and dates", async () => {
    const questions = getBuiltInTemplate("team-pulse").questions;
    const original = surveyDoc({
      title: "Gammel",
      openedAt: new Date("2026-08-15T00:00:00Z"),
      questions,
      questionSetVersion: 2,
      endAt: new Date("2026-09-30T00:00:00Z"),
    });
    const store = fakeDraftStore({ [SURVEY_ID]: original });

    const result = await updateSurveyDraft(
      "token",
      TEAM_ID,
      SURVEY_ID,
      { title: "Ny tittel", description: "Ny beskrivelse" },
      updateDeps(store),
    );

    expect(result).toEqual({ ok: true });
    const saved = openedStored(store);
    expect(saved.title).toBe("Ny tittel");
    expect(saved.description).toBe("Ny beskrivelse");
    expect(saved.questions).toEqual(questions);
    expect(saved.questionSetVersion).toBe(2);
    expect(saved.endAt).toEqual(new Date("2026-09-30T00:00:00Z"));
    expect(saved.openedAt).toEqual(new Date("2026-08-15T00:00:00Z"));
  });

  it("refuses a published survey patch that also changes questions, dates or access mode", async () => {
    const original = surveyDoc({
      openedAt: new Date("2026-08-15T00:00:00Z"),
      questions: getBuiltInTemplate("team-pulse").questions,
      questionSetVersion: 2,
    });
    const store = fakeDraftStore({ [SURVEY_ID]: original });

    const result = await updateSurveyDraft(
      "token",
      TEAM_ID,
      SURVEY_ID,
      { title: "Ny", endAt: "2026-10-01T10:00" },
      updateDeps(store),
    );

    expect(result).toEqual({ ok: false, error: "not_editable" });
    expect(openedStored(store)).toEqual(original);
  });

  it("refuses to edit the metadata of an archived survey", async () => {
    const original = surveyDoc({
      title: "Arkivert",
      openedAt: new Date("2026-08-15T00:00:00Z"),
      archivedAt: new Date("2026-09-01T00:00:00Z"),
    });
    const store = fakeDraftStore({ [SURVEY_ID]: original });

    const result = await updateSurveyDraft("token", TEAM_ID, SURVEY_ID, { title: "Ny" }, updateDeps(store));

    expect(result).toEqual({ ok: false, error: "not_editable" });
    expect(openedStored(store)).toEqual(original);
  });

  it("refuses to change the access mode or the minimum-response threshold", async () => {
    const store = fakeDraftStore({ [SURVEY_ID]: surveyDoc() });

    expect(await updateSurveyDraft("token", TEAM_ID, SURVEY_ID, { accessMode: "authenticated" }, updateDeps(store))).toEqual({
      ok: false,
      error: "immutable_field",
    });
    expect(await updateSurveyDraft("token", TEAM_ID, SURVEY_ID, { minimumResponses: 3 }, updateDeps(store))).toEqual({
      ok: false,
      error: "immutable_field",
    });
  });

  it("does not edit a survey through a different team's route", async () => {
    const store = fakeDraftStore({ [SURVEY_ID]: surveyDoc({ teamId: OTHER_TEAM_ID }) });

    const result = await updateSurveyDraft("token", TEAM_ID, SURVEY_ID, VALID_PATCH, updateDeps(store));

    expect(result).toEqual({ ok: false, error: "survey_not_found" });
  });

  it("rejects a required free-text question and persists nothing", async () => {
    const store = fakeDraftStore({ [SURVEY_ID]: surveyDoc() });
    const patch = {
      questions: [{ id: "note", type: "free_text", prompt: "Kommentar", required: true, maxLength: 200 }],
    };

    const result = await updateSurveyDraft("token", TEAM_ID, SURVEY_ID, patch, updateDeps(store));

    expect(result).toEqual({ ok: false, error: "free_text_must_be_optional" });
    expect(openedStored(store)).toEqual(surveyDoc());
  });

  it("rejects a non-admin caller before reading the survey", async () => {
    const store = fakeDraftStore({ [SURVEY_ID]: surveyDoc() });

    const result = await updateSurveyDraft(
      "token",
      TEAM_ID,
      SURVEY_ID,
      VALID_PATCH,
      updateDeps(store, { verifyToken: verifyAs(MEMBER_IDENTITY) }),
    );

    expect(result.ok).toBe(false);
    expect(store.runUpdate).not.toHaveBeenCalled();
  });
});

function fakeCreateDeps(): CreateSurveyDeps & { writes: SurveyRecord[] } {
  const writes: SurveyRecord[] = [];
  const collection: SurveysCollection = {
    add: vi.fn(async (record: SurveyRecord) => {
      writes.push(record);
      return { id: `copy-${writes.length}` };
    }),
  };
  const teamStatusReader: TeamStatusReader = { getTeamStatus: vi.fn(async () => "active") };
  return {
    writes,
    verifyToken: verifyAs(ADMIN_TOKEN_IDENTITY),
    isSuperadmin: isAdmin,
    collection,
    teamStatusReader,
    now: NOW,
  };
}

function duplicateDeps(source: unknown, create: CreateSurveyDeps): DuplicateSurveyDeps {
  return {
    verifyToken: verifyAs(ADMIN_TOKEN_IDENTITY),
    isSuperadmin: isAdmin,
    readSurvey: vi.fn(async () => (source === undefined ? undefined : persistedSurveyFixture(SURVEY_ID, source as Record<string, unknown>))),
    createDeps: create,
  };
}

describe("duplicateSurvey", () => {
  it("creates an editable draft that copies definitions but no responses or lifecycle state", async () => {
    const create = fakeCreateDeps();
    const source = surveyDoc({
      title: "Teampuls",
      description: "Beskrivelse",
      questions: TEAM_PULSE,
      questionSetVersion: 2,
      openedAt: new Date("2026-08-15T00:00:00Z"),
      closedAt: new Date("2026-08-20T00:00:00Z"),
      startAt: new Date("2026-08-14T00:00:00Z"),
      minimumResponses: 7,
    });

    const result = await duplicateSurvey("token", TEAM_ID, SURVEY_ID, duplicateDeps({ ...source, surveyId: SURVEY_ID }, create));

    expect(result).toEqual({ ok: true, surveyId: "copy-1" });
    const [written] = create.writes;
    expect(written.title).toBe("Teampuls (kopi)");
    expect(written.description).toBe("Beskrivelse");
    expect(written.minimumResponses).toBe(7);
    expect(written.questions).toEqual(TEAM_PULSE);
    expect(written).not.toHaveProperty("openedAt");
    expect(written).not.toHaveProperty("closedAt");
    expect(written).not.toHaveProperty("startAt");
    expect(written.createdBy).toBe(ADMIN_UID);
  });

  it("upgrades a legacy source to the configurable format on copy", async () => {
    const create = fakeCreateDeps();
    const legacy = surveyDoc({ title: "Gammel" });

    await duplicateSurvey("token", TEAM_ID, SURVEY_ID, duplicateDeps({ ...legacy, surveyId: SURVEY_ID }, create));

    expect(create.writes[0].questionSetVersion).toBe(CONFIGURABLE_QUESTION_SET_VERSION);
    expect(create.writes[0].questions.map((question) => question.id)).toEqual(["flow", "stress", "fun"]);
  });

  it("does not copy a survey that belongs to another team", async () => {
    const create = fakeCreateDeps();
    const foreign = surveyDoc({ teamId: OTHER_TEAM_ID });

    const result = await duplicateSurvey("token", TEAM_ID, SURVEY_ID, duplicateDeps({ ...foreign, surveyId: SURVEY_ID }, create));

    expect(result).toEqual({ ok: false, error: "survey_not_found" });
    expect(create.writes).toHaveLength(0);
  });
});

function resultsDeps(
  responses: unknown[],
  survey: Record<string, unknown>,
  overrides: Partial<GetSurveyQuestionResultsDeps> = {},
): GetSurveyQuestionResultsDeps {
  return {
    now: NOW,
    verifyToken: verifyAs(MEMBER_IDENTITY),
    isSuperadmin: async () => false,
    authCollection: {
      getTeamStatus: async () => "active",
      getMembership: async (uid: string, teamId: string) =>
        uid === MEMBER_UID && teamId === TEAM_ID
          ? { uid, teamId, createdAt: new Date("2026-08-01T00:00:00Z"), createdVia: "admin_direct", grantedBy: "admin" }
          : undefined,
    },
    collections: {
      getSurvey: async () => persistedSurveyFixture(SURVEY_ID, survey),
      listResponses: async () => responses.map((data, i) => ({ id: `response-${i + 1}`, data })),
    },
    // Decryption is replaced by identity: each fake response already carries its plaintext.
    decryptPayload: (envelope) => envelope.ciphertext,
    ...overrides,
  };
}

function encryptedFor(survey: Record<string, unknown>, answers: unknown): unknown {
  const plaintext = encodeResponsePayload(survey, answers);
  if (plaintext === null) {
    throw new Error("test fixture answers must be valid");
  }
  return {
    surveyId: SURVEY_ID,
    teamId: TEAM_ID,
    ciphertext: plaintext,
    iv: "aXY=",
    authTag: "dGFn",
    keyVersion: "v2",
    keyId: "k1",
  };
}

const CLOSED_CONFIGURED_SURVEY = surveyDoc({
  surveyId: SURVEY_ID,
  title: "Retro",
  questions: [
    { id: "went_well", type: "single_choice", prompt: "Hva fungerte?", required: true, options: [
      { id: "a", label: "Samarbeid" },
      { id: "b", label: "Leveranser" },
    ] },
    { id: "idea", type: "free_text", prompt: "Idé", required: false, maxLength: 100 },
  ],
  questionSetVersion: 2,
  openedAt: new Date("2026-08-01T00:00:00Z"),
  closedAt: new Date("2026-08-10T00:00:00Z"),
  minimumResponses: 3,
});

describe("getSurveyQuestionResults", () => {
  it("denies a caller without team membership", async () => {
    const result = await getSurveyQuestionResults(
      "token",
      TEAM_ID,
      SURVEY_ID,
      resultsDeps([], CLOSED_CONFIGURED_SURVEY, {
        verifyToken: verifyAs({ uid: "outsider", email: "x@example.com", emailVerified: true }),
      }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("returns no statistics and no free text for an open survey", async () => {
    const open = { ...CLOSED_CONFIGURED_SURVEY, closedAt: undefined };
    const responses = [encryptedFor(CLOSED_CONFIGURED_SURVEY, { went_well: "a", idea: "hemmelig tekst" })];

    const result = await getSurveyQuestionResults("token", TEAM_ID, SURVEY_ID, resultsDeps(responses, open));

    expect(result).toMatchObject({ ok: true, status: "not_closed" });
    expect(JSON.stringify(result)).not.toContain("hemmelig tekst");
  });

  it("suppresses every count below the survey's threshold", async () => {
    const responses = [encryptedFor(CLOSED_CONFIGURED_SURVEY, { went_well: "a" })];

    const result = await getSurveyQuestionResults("token", TEAM_ID, SURVEY_ID, resultsDeps(responses, CLOSED_CONFIGURED_SURVEY));

    expect(result).toMatchObject({ ok: true, status: "insufficient" });
    expect(result).not.toHaveProperty("questions");
    expect(result).not.toHaveProperty("responseCount");
  });

  it("replaces free text with a restricted marker for an app admin, who is not a team member", async () => {
    const responses = [
      encryptedFor(CLOSED_CONFIGURED_SURVEY, { went_well: "a", idea: "Privat tekst" }),
      encryptedFor(CLOSED_CONFIGURED_SURVEY, { went_well: "a", idea: "Privat tekst" }),
      encryptedFor(CLOSED_CONFIGURED_SURVEY, { went_well: "b", idea: "Privat tekst" }),
    ];

    const result = await getSurveyQuestionResults(
      "token",
      TEAM_ID,
      SURVEY_ID,
      resultsDeps(responses, CLOSED_CONFIGURED_SURVEY, {
        verifyToken: verifyAs(ADMIN_TOKEN_IDENTITY),
        isSuperadmin: isAdmin,
      }),
    );

    expect(result).toMatchObject({ ok: true, status: "published", responseCount: 3 });
    expect(JSON.stringify(result)).not.toContain("Privat tekst");
    if (!result.ok || result.status !== "published") {
      throw new Error("expected published result");
    }
    expect(result.questions[1]).toEqual({ questionId: "idea", prompt: "Idé", type: "free_text", status: "restricted" });
  });

  it("returns free text to an app admin who is also a member of the team", async () => {
    const responses = [
      encryptedFor(CLOSED_CONFIGURED_SURVEY, { went_well: "a", idea: "Mer tid til læring" }),
      encryptedFor(CLOSED_CONFIGURED_SURVEY, { went_well: "a", idea: "Bedre dokumentasjon" }),
      encryptedFor(CLOSED_CONFIGURED_SURVEY, { went_well: "b", idea: "Mer tid til læring" }),
    ];
    const adminMemberDeps = resultsDeps(responses, CLOSED_CONFIGURED_SURVEY, {
      verifyToken: verifyAs(ADMIN_TOKEN_IDENTITY),
      isSuperadmin: isAdmin,
      authCollection: {
        getTeamStatus: async () => "active",
        getMembership: async (uid: string, teamId: string) =>
          uid === ADMIN_UID && teamId === TEAM_ID ? { uid, teamId } : undefined,
      },
    });

    const result = await getSurveyQuestionResults("token", TEAM_ID, SURVEY_ID, adminMemberDeps);

    expect(result).toMatchObject({ ok: true, status: "published", responseCount: 3 });
    if (!result.ok || result.status !== "published") {
      throw new Error("expected published result");
    }
    expect(result.questions[1]).toMatchObject({ type: "free_text", status: "published", answeredCount: 3 });
    expect(JSON.stringify(result)).toContain("Bedre dokumentasjon");
  });

  it("returns a read failure, not free text, when the membership read fails", async () => {
    const responses = [
      encryptedFor(CLOSED_CONFIGURED_SURVEY, { went_well: "a", idea: "Privat tekst" }),
      encryptedFor(CLOSED_CONFIGURED_SURVEY, { went_well: "a", idea: "Privat tekst" }),
      encryptedFor(CLOSED_CONFIGURED_SURVEY, { went_well: "b", idea: "Privat tekst" }),
    ];
    const failingDeps = resultsDeps(responses, CLOSED_CONFIGURED_SURVEY, {
      authCollection: {
        getTeamStatus: async () => "active",
        getMembership: async () => {
          throw new Error("firestore down");
        },
      },
    });

    const result = await getSurveyQuestionResults("token", TEAM_ID, SURVEY_ID, failingDeps);

    expect(result).toEqual({ ok: false, error: "read_failed" });
    expect(JSON.stringify(result)).not.toContain("Privat tekst");
  });

  it("publishes per-question counts and free text only once the threshold is reached", async () => {
    const responses = [
      encryptedFor(CLOSED_CONFIGURED_SURVEY, { went_well: "a", idea: "Mer tid til læring" }),
      encryptedFor(CLOSED_CONFIGURED_SURVEY, { went_well: "a", idea: "Bedre dokumentasjon" }),
      encryptedFor(CLOSED_CONFIGURED_SURVEY, { went_well: "b", idea: "Mer tid til læring" }),
    ];

    const result = await getSurveyQuestionResults("token", TEAM_ID, SURVEY_ID, resultsDeps(responses, CLOSED_CONFIGURED_SURVEY));

    expect(result).toMatchObject({ ok: true, status: "published", responseCount: 3 });
    if (!result.ok || result.status !== "published") {
      throw new Error("expected published result");
    }
    const [choice, text] = result.questions;
    expect(choice).toMatchObject({ type: "single_choice", status: "published", answeredCount: 3 });
    if (choice.type !== "single_choice" || choice.status !== "published") {
      throw new Error("expected published single choice");
    }
    expect(choice.options.map((option) => option.count)).toEqual([2, 1]);
    expect(text).toMatchObject({ type: "free_text", status: "published", answeredCount: 3 });
    if (text.type !== "free_text" || text.status !== "published") {
      throw new Error("expected published free text");
    }
    expect(text.texts.sort()).toEqual(["Bedre dokumentasjon", "Mer tid til læring", "Mer tid til læring"]);
  });

  it("hides a question that fewer respondents than the threshold answered", async () => {
    const responses = [
      encryptedFor(CLOSED_CONFIGURED_SURVEY, { went_well: "a", idea: "Kun ett svar" }),
      encryptedFor(CLOSED_CONFIGURED_SURVEY, { went_well: "a" }),
      encryptedFor(CLOSED_CONFIGURED_SURVEY, { went_well: "b" }),
    ];

    const result = await getSurveyQuestionResults("token", TEAM_ID, SURVEY_ID, resultsDeps(responses, CLOSED_CONFIGURED_SURVEY));

    expect(result.ok && result.status === "published").toBe(true);
    if (!result.ok || result.status !== "published") {
      throw new Error("expected published result");
    }
    const text = result.questions[1];
    expect(text).toEqual({ questionId: "idea", prompt: "Idé", type: "free_text", status: "insufficient" });
    expect(JSON.stringify(result)).not.toContain("Kun ett svar");
  });

  it("excludes responses that fail to decrypt instead of guessing", async () => {
    const good = [
      encryptedFor(CLOSED_CONFIGURED_SURVEY, { went_well: "a" }),
      encryptedFor(CLOSED_CONFIGURED_SURVEY, { went_well: "a" }),
      encryptedFor(CLOSED_CONFIGURED_SURVEY, { went_well: "b" }),
    ];
    const broken = { ...(good[0] as Record<string, unknown>), ciphertext: "not-a-valid-payload" };

    const result = await getSurveyQuestionResults(
      "token",
      TEAM_ID,
      SURVEY_ID,
      resultsDeps([...good, broken], CLOSED_CONFIGURED_SURVEY, {
        decryptPayload: (payload) => {
          if (payload.ciphertext === "not-a-valid-payload") {
            throw new Error("auth failed");
          }
          return payload.ciphertext;
        },
      }),
    );

    expect(result).toMatchObject({ ok: true, status: "published", responseCount: 3 });
  });
});

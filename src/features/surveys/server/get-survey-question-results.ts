import "server-only";
import { decryptRecord, type RecordEnvelope } from "../../../lib/encryption/record-envelope";
import { surveyResponseContext } from "../domain/response-context";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { type AuthRefusal, authRefusalFor } from "../../auth/server/auth-refusal";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../../teams/domain/app-admin";
import {
  authorizeTeamAccess,
  authorizeTeamMembership,
  type AuthorizeTeamAccessCollection,
} from "../../teams/server/authorize-team-access";
import { type AnswerValue } from "../domain/question-definitions";
import { decodeResponsePayload } from "../domain/response-payload";
import { computeSurveyStatistics, restrictFreeText, type QuestionStatistics } from "../domain/question-statistics";
import { effectiveLifecycle, isValidSurvey, resolveSurveyQuestions, type Survey } from "../domain/survey";
import { toCandidateSurvey } from "./survey-candidate";

const SURVEYS_COLLECTION = "surveys";
const SURVEY_RESPONSES_COLLECTION = "surveyResponses";

/** The survey header returned with every outcome. Never includes response counts unless published. */
export interface SurveyResultsHeader {
  surveyId: string;
  title?: string;
  description?: string;
  accessMode: Survey["accessMode"];
  minimumResponses: number;
}

export type SurveyQuestionResultsResult =
  | { ok: true; status: "not_closed"; survey: SurveyResultsHeader }
  | { ok: true; status: "insufficient"; survey: SurveyResultsHeader }
  | {
      ok: true;
      status: "published";
      survey: SurveyResultsHeader;
      responseCount: number;
      questions: QuestionStatistics[];
    }
  | { ok: false; error: AuthRefusal | "forbidden" | "survey_not_found" | "read_failed" };

/** The read seam, satisfied in production by Firestore and by an in-memory fake in tests. */
export interface SurveyQuestionResultsCollections {
  /** Raw `surveys/{surveyId}` data, or `undefined` if no such document exists. */
  getSurvey(surveyId: string): Promise<unknown>;
  /** Raw `surveyResponses` documents for one survey. Validated by this module before use. */
  listResponses(surveyId: string): Promise<Array<{ id: string; data: unknown }>>;
}

export interface GetSurveyQuestionResultsDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  isSuperadmin?: IsAppAdminDeps["isSuperadmin"];
  authCollection?: AuthorizeTeamAccessCollection;
  collections?: SurveyQuestionResultsCollections;
  decryptPayload?: (envelope: RecordEnvelope, context: string) => string;
}

function getDefaultCollections(): SurveyQuestionResultsCollections {
  return {
    async getSurvey(surveyId) {
      const snapshot = await getFirestoreDb().collection(SURVEYS_COLLECTION).doc(surveyId).get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
    async listResponses(surveyId) {
      const snapshot = await getFirestoreDb()
        .collection(SURVEY_RESPONSES_COLLECTION)
        .where("surveyId", "==", surveyId)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
  };
}

function toHeader(survey: Survey): SurveyResultsHeader {
  return {
    surveyId: survey.surveyId,
    ...(survey.title !== undefined ? { title: survey.title } : {}),
    ...(survey.description !== undefined ? { description: survey.description } : {}),
    accessMode: survey.accessMode,
    minimumResponses: survey.minimumResponses,
  };
}

function isEncryptedRecord(value: unknown, surveyId: string, teamId: string): value is RecordEnvelope & {
  surveyId: string;
  teamId: string;
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.surveyId === surveyId &&
    record.teamId === teamId &&
    typeof record.ciphertext === "string" &&
    typeof record.iv === "string" &&
    typeof record.authTag === "string" &&
    record.keyVersion === "v2" &&
    record.keyId === "k1"
  );
}

/**
 * Per-question results for one closed survey (team-survey-builder TSB-008).
 * Authorization matches the existing team-results boundary: a verified
 * identity that `authorizeTeamAccess` grants as member or admin. Results are
 * never returned for an `open` or `scheduled` survey, and each response is
 * decrypted, decoded against the survey's own question set, and counted only
 * if it validates. Anything that fails to decrypt or decode is excluded, not
 * guessed at, and nothing about it is logged.
 */
export async function getSurveyQuestionResults(
  idToken: string,
  teamId: string,
  surveyId: string,
  deps: GetSurveyQuestionResultsDeps = {},
): Promise<SurveyQuestionResultsResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) {
    return { ok: false, error: authRefusalFor(verified) };
  }

  const access = await authorizeTeamAccess(verified.identity, teamId, {
    isSuperadmin: deps.isSuperadmin,
    collection: deps.authCollection,
  });
  if (!access.ok) {
    return { ok: false, error: "read_failed" };
  }
  if (access.access === "denied") {
    return { ok: false, error: "forbidden" };
  }

  // Free-text visibility is decided by genuine membership, not by `access.access`:
  // an app admin who is also a team member must keep access through membership.
  const membership = await authorizeTeamMembership(verified.identity, teamId, {
    collection: deps.authCollection,
  });
  if (!membership.ok) {
    return { ok: false, error: "read_failed" };
  }

  const collections = deps.collections ?? getDefaultCollections();
  let rawSurvey: unknown;
  try {
    rawSurvey = await collections.getSurvey(surveyId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const candidate = toCandidateSurvey(surveyId, rawSurvey);
  if (!isValidSurvey(candidate, { surveyId }) || candidate.teamId !== teamId) {
    return { ok: false, error: "survey_not_found" };
  }
  const survey: Survey = candidate;
  const header = toHeader(survey);

  if (effectiveLifecycle(survey, deps.now ?? new Date()) !== "closed") {
    return { ok: true, status: "not_closed", survey: header };
  }

  let rawResponses: Array<{ id: string; data: unknown }>;
  try {
    rawResponses = await collections.listResponses(surveyId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const decryptFn = deps.decryptPayload ?? decryptRecord;
  const responses: Record<string, AnswerValue>[] = [];
  for (const { id: responseId, data } of rawResponses) {
    if (!isEncryptedRecord(data, surveyId, teamId)) {
      continue;
    }
    const raw = data;
    try {
      const plaintext = decryptFn(
        {
          ciphertext: raw.ciphertext,
          iv: raw.iv,
          authTag: raw.authTag,
          keyVersion: raw.keyVersion,
          keyId: raw.keyId,
        },
        surveyResponseContext(teamId, surveyId, responseId),
      );
      const answers = decodeResponsePayload(survey, plaintext);
      if (answers !== null) {
        responses.push(answers);
      }
    } catch {
      // Undecryptable or undecodable: excluded, never logged.
    }
  }

  const stats = computeSurveyStatistics(resolveSurveyQuestions(survey), responses, survey.minimumResponses);
  if (stats.status === "insufficient") {
    return { ok: true, status: "insufficient", survey: header };
  }
  // Free text is returned only to a genuine member of this team (SECURITY invariant 17).
  // Admin access alone never grants it; a non-member app admin gets the restricted marker.
  const mayReadFreeText = membership.isMember;
  return {
    ok: true,
    status: "published",
    survey: header,
    responseCount: stats.responseCount,
    questions: mayReadFreeText ? stats.questions : restrictFreeText(stats.questions),
  };
}

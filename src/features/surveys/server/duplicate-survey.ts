import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { type AuthRefusal } from "../../auth/server/auth-refusal";
import { type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../../teams/domain/app-admin";
import { requireAppAdmin } from "../../teams/server/require-app-admin";
import { isValidSurvey, resolveSurveyQuestions, type Survey } from "../domain/survey";
import { createSurvey, type CreateSurveyDeps, type CreateSurveyResult } from "./create-survey";
import { toCandidateSurvey } from "./survey-candidate";

const SURVEYS_COLLECTION = "surveys";
const DUPLICATE_TITLE_SUFFIX = " (kopi)";

export interface DuplicateSurveyDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  isSuperadmin?: IsAppAdminDeps["isSuperadmin"];
  /** Reads the raw source document, or `undefined` when it doesn't exist. */
  readSurvey?: (surveyId: string) => Promise<unknown>;
  /** Passed through to `createSurvey`, which re-checks admin and team status. */
  createDeps?: CreateSurveyDeps;
}

export type DuplicateSurveyResult =
  | CreateSurveyResult
  | { ok: false; error: AuthRefusal | "forbidden" | "survey_not_found" | "read_failed" };

function defaultReadSurvey(surveyId: string): Promise<unknown> {
  return getFirestoreDb()
    .collection(SURVEYS_COLLECTION)
    .doc(surveyId)
    .get()
    .then((snapshot) => (snapshot.exists ? snapshot.data() : undefined));
}

/**
 * Creates a new, editable draft that copies `sourceSurveyId`'s definitions
 * (team-survey-builder TSB-004). Copies the title (suffixed), description,
 * access mode, threshold and question set. It never copies responses,
 * participations, or any lifecycle timestamp, so the copy always starts as a
 * draft. Legacy sources are upgraded to the configurable format on copy.
 */
export async function duplicateSurvey(
  idToken: string,
  teamId: string,
  sourceSurveyId: string,
  deps: DuplicateSurveyDeps = {},
): Promise<DuplicateSurveyResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    isSuperadmin: deps.isSuperadmin,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  let raw: unknown;
  try {
    raw = await (deps.readSurvey ?? defaultReadSurvey)(sourceSurveyId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const candidate = toCandidateSurvey(sourceSurveyId, raw);
  if (!isValidSurvey(candidate, { surveyId: sourceSurveyId })) {
    return { ok: false, error: "survey_not_found" };
  }
  const source: Survey = candidate;
  if (source.teamId !== teamId) {
    return { ok: false, error: "survey_not_found" };
  }

  return createSurvey(
    idToken,
    teamId,
    {
      accessMode: source.accessMode,
      minimumResponses: source.minimumResponses,
      ...(source.title !== undefined && source.title.trim() !== ""
        ? { title: `${source.title}${DUPLICATE_TITLE_SUFFIX}` }
        : {}),
      ...(source.description !== undefined ? { description: source.description } : {}),
      questions: resolveSurveyQuestions(source),
    },
    deps.createDeps,
  );
}

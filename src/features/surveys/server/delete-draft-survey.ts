import "server-only";
import { type AuthRefusal } from "../../auth/server/auth-refusal";
import { type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../../teams/domain/app-admin";
import { requireAppAdmin } from "../../teams/server/require-app-admin";
import { isValidSurvey, type Survey } from "../domain/survey";
import {
  getDefaultResponsesExistenceReader,
  getDefaultSurveyDocStore,
  type DeleteOrArchiveSurveyDocSnapshot,
  type SurveyDocStore,
  type SurveyResponsesExistenceReader,
} from "./delete-or-archive-survey";
import { toCandidateSurvey } from "./survey-candidate";

export type DeleteDraftSurveyResult =
  | { ok: true; outcome: "deleted" }
  | {
      ok: false;
      error:
        | AuthRefusal
        | "forbidden"
        | "survey_not_found"
        | "wrong_team"
        | "not_draft"
        | "has_responses"
        | "persistence_failed";
    };

export interface DeleteDraftSurveyDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  isSuperadmin?: IsAppAdminDeps["isSuperadmin"];
  surveyDocs?: SurveyDocStore;
  responses?: SurveyResponsesExistenceReader;
}

/**
 * Permanently deletes an unpublished draft (team-survey-builder SPEC —
 * "Draft deletion"). A survey is a draft only while it has never been opened
 * and is not archived. Deletion also requires zero stored responses, checked
 * on the server, so published surveys and any survey with responses can't be
 * removed through this path. Only an app admin may call it.
 *
 * `teamId` is the caller's route scope and is checked against the survey's own
 * `teamId`. A mismatch is `wrong_team`, so one team's route can't delete another
 * team's survey.
 */
export async function deleteDraftSurvey(
  idToken: string,
  teamId: string,
  surveyId: string,
  deps: DeleteDraftSurveyDeps = {},
): Promise<DeleteDraftSurveyResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    isSuperadmin: deps.isSuperadmin,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const surveyDocs = deps.surveyDocs ?? getDefaultSurveyDocStore(admin.identity.uid);

  let snapshot: DeleteOrArchiveSurveyDocSnapshot;
  try {
    snapshot = await surveyDocs.get(surveyId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  const candidate = toCandidateSurvey(surveyId, snapshot.exists ? snapshot.data() : undefined);
  if (!isValidSurvey(candidate, { surveyId })) {
    return { ok: false, error: "survey_not_found" };
  }
  const survey: Survey = candidate;

  if (survey.teamId !== teamId) {
    return { ok: false, error: "wrong_team" };
  }
  if (survey.openedAt !== undefined || survey.archivedAt !== undefined) {
    return { ok: false, error: "not_draft" };
  }

  const responses = deps.responses ?? getDefaultResponsesExistenceReader();
  let hasResponses: boolean;
  try {
    hasResponses = await responses.hasAnyResponses(surveyId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
  if (hasResponses) {
    return { ok: false, error: "has_responses" };
  }

  try {
    await surveyDocs.delete(surveyId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
  return { ok: true, outcome: "deleted" };
}

import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { type AuthRefusal, authRefusalFor } from "../../auth/server/auth-refusal";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../../teams/domain/app-admin";
import {
  authorizeTeamAccess,
  type AuthorizeTeamAccessCollection,
} from "../../teams/server/authorize-team-access";
import { effectiveLifecycle, isLegacySurvey, isValidSurvey, type Survey } from "../domain/survey";
import { toCandidateSurvey } from "./survey-candidate";

const SURVEYS_COLLECTION = "surveys";

/**
 * One closed configurable survey, as offered to the team results page for
 * per-question results (team-survey-builder TSB-008). Only the header fields the
 * page needs. No `createdBy`, no response counts, and no encrypted data.
 * Legacy Team Pulse surveys are excluded here: they stay in the existing
 * Flow/Stress/Fun trend.
 */
export interface TeamResultsSurveyEntry {
  surveyId: string;
  title?: string;
  minimumResponses: number;
  closedAt?: string;
}

export type ListTeamResultsSurveysResult =
  | { ok: true; surveys: TeamResultsSurveyEntry[] }
  | { ok: false; error: AuthRefusal | "forbidden" | "read_failed" };

export interface SurveyListCollections {
  /** Raw `surveys` documents for one team, each paired with its document id. */
  listSurveysForTeam(teamId: string): Promise<{ id: string; data: unknown }[]>;
}

export interface ListTeamResultsSurveysDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  isSuperadmin?: IsAppAdminDeps["isSuperadmin"];
  authCollection?: AuthorizeTeamAccessCollection;
  collections?: SurveyListCollections;
}

function getDefaultCollections(): SurveyListCollections {
  return {
    async listSurveysForTeam(teamId) {
      const snapshot = await getFirestoreDb()
        .collection(SURVEYS_COLLECTION)
        .where("teamId", "==", teamId)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
  };
}

function toEntry(survey: Survey): TeamResultsSurveyEntry {
  return {
    surveyId: survey.surveyId,
    ...(survey.title !== undefined ? { title: survey.title } : {}),
    minimumResponses: survey.minimumResponses,
    ...(survey.closedAt !== undefined ? { closedAt: survey.closedAt.toISOString() } : {}),
  };
}

/**
 * Lists the team's closed configurable surveys that have per-question results.
 * Authorization is the same as the results endpoint (`authorizeTeamAccess`, so
 * a team member or app admin). Access for free text is decided separately, per
 * survey, by `getSurveyQuestionResults`. Surveys that fail validation are
 * excluded, not guessed at.
 */
export async function listTeamResultsSurveys(
  idToken: string,
  teamId: string,
  deps: ListTeamResultsSurveysDeps = {},
): Promise<ListTeamResultsSurveysResult> {
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

  const collections = deps.collections ?? getDefaultCollections();
  let rows: { id: string; data: unknown }[];
  try {
    rows = await collections.listSurveysForTeam(teamId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const now = deps.now ?? new Date();
  const surveys: TeamResultsSurveyEntry[] = [];
  for (const row of rows) {
    const candidate = toCandidateSurvey(row.id, row.data);
    if (!isValidSurvey(candidate, { surveyId: row.id }) || candidate.teamId !== teamId) {
      continue;
    }
    const survey: Survey = candidate;
    // Never-opened surveys are drafts, even when their endAt has passed.
    if (survey.openedAt === undefined || effectiveLifecycle(survey, now) !== "closed") {
      continue;
    }
    if (isLegacySurvey(survey)) {
      continue;
    }
    surveys.push(toEntry(survey));
  }

  surveys.sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));
  return { ok: true, surveys };
}

/**
 * Client gateways for the team survey workspace (team-survey-builder
 * TSB-004 to TSB-008): draft update, duplication, and per-question results.
 * Each is a thin `fetch` wrapper around an admin or team API route. Authorization,
 * lifecycle, and suppression rules are enforced on the server only; the UI uses
 * these results purely for display. Parsers fail to a generic status rather than
 * rendering untrusted or partial data.
 */
import type { QuestionStatistics } from "../domain/question-statistics";
import type { SurveyQuestion } from "../domain/question-definitions";

export interface DraftPatch {
  title?: string | null;
  description?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  questions?: SurveyQuestion[];
}

export type MutationResult = { ok: true } | { ok: false; error: string };

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function errorCodeOf(body: unknown): string {
  if (typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return "unknown";
}

export async function updateSurveyDraft(
  idToken: string,
  teamId: string,
  surveyId: string,
  patch: DraftPatch,
): Promise<MutationResult> {
  try {
    const response = await fetch(
      `/api/admin/teams/${encodeURIComponent(teamId)}/surveys/${encodeURIComponent(surveyId)}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${idToken}`, "content-type": "application/json" },
        body: JSON.stringify(patch),
      },
    );
    if (response.ok) {
      return { ok: true };
    }
    return { ok: false, error: errorCodeOf(await parseJson(response)) };
  } catch {
    return { ok: false, error: "unknown" };
  }
}

export type DuplicateResult = { ok: true; surveyId: string } | { ok: false; error: string };

export async function duplicateSurvey(
  idToken: string,
  teamId: string,
  surveyId: string,
): Promise<DuplicateResult> {
  try {
    const response = await fetch(
      `/api/admin/teams/${encodeURIComponent(teamId)}/surveys/${encodeURIComponent(surveyId)}/duplicate`,
      { method: "POST", headers: { Authorization: `Bearer ${idToken}` } },
    );
    const body = await parseJson(response);
    if (response.ok && typeof body === "object" && body !== null) {
      const id = (body as { surveyId?: unknown }).surveyId;
      if (typeof id === "string" && id.length > 0) {
        return { ok: true, surveyId: id };
      }
    }
    return { ok: false, error: errorCodeOf(body) };
  } catch {
    return { ok: false, error: "unknown" };
  }
}

export interface SurveyResultsHeader {
  surveyId: string;
  title?: string;
  description?: string;
  accessMode: "public" | "authenticated";
  minimumResponses: number;
}

export type SurveyResultsFetchResult =
  | { status: "not_closed"; survey: SurveyResultsHeader }
  | { status: "insufficient"; survey: SurveyResultsHeader }
  | { status: "published"; survey: SurveyResultsHeader; responseCount: number; questions: QuestionStatistics[] }
  | { status: "unauthenticated" | "forbidden" | "survey_not_found" | "read_failed" };

const RESULT_STATUSES = new Set(["not_closed", "insufficient", "published"]);

function isResultsHeader(value: unknown): value is SurveyResultsHeader {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.surveyId === "string" &&
    typeof record.minimumResponses === "number" &&
    (record.accessMode === "public" || record.accessMode === "authenticated")
  );
}

function parseResults(body: unknown): SurveyResultsFetchResult {
  if (typeof body !== "object" || body === null) {
    return { status: "read_failed" };
  }
  const record = body as Record<string, unknown>;
  if (record.ok !== true) {
    const error = errorCodeOf(body);
    if (error === "unauthenticated" || error === "forbidden" || error === "survey_not_found") {
      return { status: error };
    }
    return { status: "read_failed" };
  }
  if (typeof record.status !== "string" || !RESULT_STATUSES.has(record.status) || !isResultsHeader(record.survey)) {
    return { status: "read_failed" };
  }
  if (record.status !== "published") {
    return { status: record.status as "not_closed" | "insufficient", survey: record.survey };
  }
  if (typeof record.responseCount !== "number" || !Array.isArray(record.questions)) {
    return { status: "read_failed" };
  }
  return {
    status: "published",
    survey: record.survey,
    responseCount: record.responseCount,
    questions: record.questions as QuestionStatistics[],
  };
}

export async function fetchSurveyResults(
  idToken: string,
  teamId: string,
  surveyId: string,
): Promise<SurveyResultsFetchResult> {
  try {
    const response = await fetch(
      `/api/teams/${encodeURIComponent(teamId)}/surveys/${encodeURIComponent(surveyId)}/results`,
      { headers: { Authorization: `Bearer ${idToken}` } },
    );
    return parseResults(await parseJson(response));
  } catch {
    return { status: "read_failed" };
  }
}

/** Deletes an unpublished draft with no responses (team-survey-builder SPEC — "Draft deletion"). */
export async function deleteDraftSurvey(idToken: string, teamId: string, surveyId: string): Promise<MutationResult> {
  try {
    const response = await fetch(
      `/api/admin/teams/${encodeURIComponent(teamId)}/surveys/${encodeURIComponent(surveyId)}/draft`,
      { method: "DELETE", headers: { Authorization: `Bearer ${idToken}` } },
    );
    if (response.ok) {
      return { ok: true };
    }
    return { ok: false, error: errorCodeOf(await parseJson(response)) };
  } catch {
    return { ok: false, error: "unknown" };
  }
}

/** One closed configurable survey offered to the team results page. Mirrors the server's `TeamResultsSurveyEntry`. */
export interface TeamResultsSurveyItem {
  surveyId: string;
  title?: string;
  minimumResponses: number;
}

export type TeamResultsSurveysFetchResult =
  | { status: "ok"; surveys: TeamResultsSurveyItem[] }
  | { status: "unauthenticated" | "forbidden" | "read_failed" };

function isTeamResultsSurveyItem(value: unknown): value is TeamResultsSurveyItem {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.surveyId === "string" &&
    record.surveyId.length > 0 &&
    typeof record.minimumResponses === "number" &&
    (record.title === undefined || typeof record.title === "string")
  );
}

export async function fetchTeamResultsSurveys(idToken: string, teamId: string): Promise<TeamResultsSurveysFetchResult> {
  try {
    const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/surveys`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const body = await parseJson(response);
    if (typeof body !== "object" || body === null) {
      return { status: "read_failed" };
    }
    const record = body as Record<string, unknown>;
    if (record.ok !== true) {
      const error = errorCodeOf(body);
      return error === "unauthenticated" || error === "forbidden" ? { status: error } : { status: "read_failed" };
    }
    if (!Array.isArray(record.surveys) || !record.surveys.every(isTeamResultsSurveyItem)) {
      return { status: "read_failed" };
    }
    return { status: "ok", surveys: record.surveys };
  } catch {
    return { status: "read_failed" };
  }
}

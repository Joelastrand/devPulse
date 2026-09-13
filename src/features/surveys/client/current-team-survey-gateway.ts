/**
 * Client gateway for `/teams/[teamId]`'s "Pågående undersøkelse" section
 * (docs/features/managed-surveys/SPEC.md — TASK-010). A thin `fetch`
 * wrapper around `GET /api/teams/[teamId]/current-survey`, mirroring
 * `team-results-gateway.ts`/`survey-participation-gateway.ts`'s established
 * shape-validation-before-trust convention — an unrecognized/malformed
 * response body or a network failure always falls back to `"read_failed"`,
 * never a fabricated empty state or a thrown error reaching the component.
 * No lifecycle/authorization logic lives here.
 */

export type SurveyAccessMode = "public" | "authenticated";

/** One survey row, as returned by `GET /api/teams/[teamId]/current-survey` — dates transported as ISO strings. */
export interface CurrentTeamSurveySummary {
  surveyId: string;
  title?: string;
  accessMode: SurveyAccessMode;
  lifecycle: "scheduled" | "open";
  startAt?: string;
  endAt?: string;
}

type ReadErrorStatus = "unauthenticated" | "forbidden" | "read_failed";

export type FetchCurrentTeamSurveyResult =
  | { status: "ok"; survey: CurrentTeamSurveySummary | null }
  | { status: ReadErrorStatus };

const KNOWN_READ_ERRORS = new Set<ReadErrorStatus>(["unauthenticated", "forbidden", "read_failed"]);
const ACCESS_MODES = new Set<SurveyAccessMode>(["public", "authenticated"]);
const LIFECYCLES = new Set(["scheduled", "open"]);

function isKnownReadError(value: unknown): value is ReadErrorStatus {
  return typeof value === "string" && KNOWN_READ_ERRORS.has(value as ReadErrorStatus);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isCurrentTeamSurveySummary(value: unknown): value is CurrentTeamSurveySummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    isNonEmptyString(record.surveyId) &&
    isOptionalString(record.title) &&
    typeof record.accessMode === "string" &&
    ACCESS_MODES.has(record.accessMode as SurveyAccessMode) &&
    typeof record.lifecycle === "string" &&
    LIFECYCLES.has(record.lifecycle) &&
    isOptionalString(record.startAt) &&
    isOptionalString(record.endAt)
  );
}

function isFetchCurrentTeamSurveyResult(value: unknown): value is FetchCurrentTeamSurveyResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.status === "ok") {
    return record.survey === null || isCurrentTeamSurveySummary(record.survey);
  }
  return isKnownReadError(record.status);
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export interface CurrentTeamSurveyGateway {
  fetchCurrentTeamSurvey(idToken: string, teamId: string): Promise<FetchCurrentTeamSurveyResult>;
}

function getDefaultGateway(): CurrentTeamSurveyGateway {
  return {
    async fetchCurrentTeamSurvey(idToken, teamId) {
      try {
        const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/current-survey`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const parsed = await parseJson(response);
        return isFetchCurrentTeamSurveyResult(parsed) ? parsed : { status: "read_failed" };
      } catch {
        return { status: "read_failed" };
      }
    },
  };
}

export interface FetchCurrentTeamSurveyDeps {
  gateway?: CurrentTeamSurveyGateway;
}

/**
 * Fetches the current-survey summary for `teamId`, for an already
 * authenticated caller. `idToken` is forwarded only for the server to
 * verify — never treated as authorization by this client code itself
 * (`.claude/rules/security.md`).
 */
export async function fetchCurrentTeamSurvey(
  idToken: string,
  teamId: string,
  deps: FetchCurrentTeamSurveyDeps = {},
): Promise<FetchCurrentTeamSurveyResult> {
  const gateway = deps.gateway ?? getDefaultGateway();
  return gateway.fetchCurrentTeamSurvey(idToken, teamId);
}

/**
 * Client gateway for `/teams/[teamId]`'s survey-instance results/history
 * section (docs/features/managed-surveys/SPEC.md — TASK-012). A thin
 * `fetch` wrapper around `GET /api/teams/[teamId]/results`, now backed by
 * TASK-011's `getTeamSurveyResults` instead of the retired calendar-period
 * aggregation. Mirrors `current-team-survey-gateway.ts`'s
 * shape-validation-before-trust convention — an unrecognized/malformed
 * response body or a network failure always falls back to `"read_failed"`,
 * never a fabricated empty/published result. No lifecycle/authorization/
 * aggregation logic lives here.
 */

export interface DimensionMeansSummary {
  flow: number;
  stress: number;
  fun: number;
}

/**
 * One closed survey's result entry, as returned by
 * `GET /api/teams/[teamId]/results` — `date` is transported as an ISO
 * string (mirrors `CurrentTeamSurveySummary`'s own date-transport
 * convention), parsed into a `Date` only at render time. Below threshold,
 * `mean`/`count` are entirely absent — never a suppressed placeholder value
 * (docs/SECURITY.md invariants 10-12).
 */
export type SurveyResultSummary =
  | {
      surveyId: string;
      title?: string;
      date: string;
      minimumResponses: number;
      status: "insufficient";
    }
  | {
      surveyId: string;
      title?: string;
      date: string;
      minimumResponses: number;
      status: "published";
      mean: DimensionMeansSummary;
      count: number;
    };

type ReadErrorStatus = "unauthenticated" | "forbidden" | "read_failed";

/**
 * The shape `GET /api/teams/[teamId]/results` returns (see
 * `app/api/teams/[teamId]/results/route.ts`). Never carries raw/individual
 * response data — only the per-survey aggregate/suppressed entries
 * `getTeamSurveyResults` already computed server-side.
 */
export type TeamResultsFetchResult =
  | { status: ReadErrorStatus }
  | { status: "ok"; teamId: string; results: SurveyResultSummary[] };

const KNOWN_READ_ERRORS = new Set<ReadErrorStatus>(["unauthenticated", "forbidden", "read_failed"]);

function isKnownReadError(value: unknown): value is ReadErrorStatus {
  return typeof value === "string" && KNOWN_READ_ERRORS.has(value as ReadErrorStatus);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isValidIsoDateString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isDimensionMeansSummary(value: unknown): value is DimensionMeansSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    isFiniteNumber(record.flow) && isFiniteNumber(record.stress) && isFiniteNumber(record.fun)
  );
}

/**
 * Fail-safe shape validator for one result entry — malformed JSON, a
 * missing/wrong-typed field, an invalid date, or an unrecognized `status`
 * all return `false` rather than throwing or coercing into a fabricated
 * published/insufficient result.
 */
function isSurveyResultSummary(value: unknown): value is SurveyResultSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;

  if (
    !isNonEmptyString(record.surveyId) ||
    !isOptionalString(record.title) ||
    !isValidIsoDateString(record.date) ||
    !isNonNegativeInteger(record.minimumResponses)
  ) {
    return false;
  }

  if (record.status === "insufficient") {
    return true;
  }
  if (record.status === "published") {
    return isDimensionMeansSummary(record.mean) && isNonNegativeInteger(record.count);
  }
  return false;
}

function isTeamResultsFetchResult(value: unknown): value is TeamResultsFetchResult {
  if (typeof value !== "object" || value === null || !("status" in value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const { status } = record;
  if (status === "ok") {
    return (
      typeof record.teamId === "string" &&
      Array.isArray(record.results) &&
      record.results.every(isSurveyResultSummary)
    );
  }

  return isKnownReadError(status);
}

/**
 * The read seam this feature depends on, satisfied in production by a
 * `fetch` call and by an in-memory fake in tests (mirrors `DashboardGateway`).
 */
export interface TeamResultsGateway {
  fetchTeamResults(idToken: string, teamId: string): Promise<TeamResultsFetchResult>;
}

function getDefaultGateway(): TeamResultsGateway {
  return {
    async fetchTeamResults(idToken, teamId) {
      try {
        const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/results`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const parsed: unknown = await response.json();
        return isTeamResultsFetchResult(parsed) ? parsed : { status: "read_failed" };
      } catch {
        return { status: "read_failed" };
      }
    },
  };
}

export interface FetchTeamResultsDeps {
  gateway?: TeamResultsGateway;
}

/**
 * Fetches the signed-in caller's survey-instance results/history for one
 * specific team from the protected `GET /api/teams/[teamId]/results`
 * endpoint. `idToken` and `teamId` are the only inputs — no authorization
 * decision is made here; the server always re-derives access via
 * `authorizeTeamAccess` before any protected data is returned.
 */
export async function fetchTeamResults(
  idToken: string,
  teamId: string,
  deps: FetchTeamResultsDeps = {},
): Promise<TeamResultsFetchResult> {
  const gateway = deps.gateway ?? getDefaultGateway();
  return gateway.fetchTeamResults(idToken, teamId);
}

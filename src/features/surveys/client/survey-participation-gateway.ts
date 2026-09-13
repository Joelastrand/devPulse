/**
 * The safe, privacy-minimized survey metadata `GET /api/surveys/[surveyId]`
 * exposes once a caller is authorized to see it at all — mirrors
 * `resolveSurveyForParticipation`'s own `SafeSurveyParticipationView`
 * exactly (never `accessMode`, `createdBy`, `archivedAt`, or any
 * `teamSurveyState`-shaped field).
 */
export interface SurveyParticipationSummary {
  surveyId: string;
  title?: string;
  teamName?: string;
}

/**
 * The shape `GET /api/surveys/[surveyId]` returns, mirroring
 * `resolveSurveyForParticipation`'s outcome one-for-one
 * (docs/features/managed-surveys/SPEC.md — TASK-005). `not_found`,
 * `sign_in_required`, and `forbidden` never carry a `survey` field — there
 * is nothing safe to attach for those outcomes.
 */
export type SurveyParticipationFetchResult =
  | { status: "not_found" }
  | { status: "sign_in_required" }
  | { status: "forbidden" }
  | { status: "read_failed" }
  | { status: "scheduled"; survey: SurveyParticipationSummary }
  | { status: "closed"; survey: SurveyParticipationSummary }
  | { status: "answerable"; survey: SurveyParticipationSummary };

const STATUSES_WITHOUT_SURVEY = new Set(["not_found", "sign_in_required", "forbidden", "read_failed"]);
const STATUSES_WITH_SURVEY = new Set(["scheduled", "closed", "answerable"]);

/**
 * Narrows an untrusted parsed response body. Shape validation only — it
 * never re-derives the authorization/lifecycle decision
 * `resolveSurveyForParticipation` already made server-side.
 */
function isSurveyParticipationFetchResult(value: unknown): value is SurveyParticipationFetchResult {
  if (typeof value !== "object" || value === null || !("status" in value)) {
    return false;
  }

  const { status } = value as { status: unknown };
  if (typeof status !== "string") {
    return false;
  }

  if (STATUSES_WITHOUT_SURVEY.has(status)) {
    return true;
  }

  return STATUSES_WITH_SURVEY.has(status) && "survey" in value;
}

/**
 * The read seam this feature depends on, satisfied in production by a
 * `fetch` call and by an in-memory fake in tests (mirrors
 * `TeamResultsGateway`).
 */
export interface SurveyParticipationGateway {
  fetchSurveyParticipation(
    surveyId: string,
    idToken: string | undefined,
  ): Promise<SurveyParticipationFetchResult>;
}

function getDefaultGateway(): SurveyParticipationGateway {
  return {
    async fetchSurveyParticipation(surveyId, idToken) {
      try {
        const response = await fetch(`/api/surveys/${encodeURIComponent(surveyId)}`, {
          headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
        });
        const parsed: unknown = await response.json();
        return isSurveyParticipationFetchResult(parsed) ? parsed : { status: "read_failed" };
      } catch {
        return { status: "read_failed" };
      }
    },
  };
}

export interface FetchSurveyParticipationDeps {
  gateway?: SurveyParticipationGateway;
}

/**
 * Fetches `/survey/{surveyId}`'s rendering state for the current caller
 * (anonymous for `public`, optionally identified for `authenticated`).
 * `idToken` is forwarded only for the server to verify — never treated as
 * authorization by this client code itself (`.claude/rules/security.md`).
 */
export async function fetchSurveyParticipation(
  surveyId: string,
  idToken: string | undefined,
  deps: FetchSurveyParticipationDeps = {},
): Promise<SurveyParticipationFetchResult> {
  const gateway = deps.gateway ?? getDefaultGateway();
  return gateway.fetchSurveyParticipation(surveyId, idToken);
}

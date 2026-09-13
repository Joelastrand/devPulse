/**
 * The shape `POST /api/surveys/[surveyId]/responses` returns, mirroring
 * `submitSurveyResponse`'s own `SubmitSurveyResponseResult` one-for-one
 * (docs/features/managed-surveys/SPEC.md — TASK-006). Never carries a
 * generated response/participation id — SPEC step 10.
 */
export type SubmitSurveyResponseFetchResult =
  | { status: "ok" }
  | {
      status:
        | "invalid_submission"
        | "survey_unavailable"
        | "unauthenticated"
        | "forbidden"
        | "already_submitted"
        | "read_failed";
    };

const KNOWN_ERROR_STATUSES = new Set([
  "invalid_submission",
  "survey_unavailable",
  "unauthenticated",
  "forbidden",
  "already_submitted",
  "read_failed",
]);

/**
 * The write seam this feature depends on, satisfied in production by a
 * `fetch` call and by an in-memory fake in tests (mirrors
 * `PulseSurveyForm`'s own inline `fetch` usage, extracted here so
 * `SurveyResponseForm` never talks to `fetch` directly).
 */
export interface SubmitSurveyResponseGateway {
  submitSurveyResponse(
    surveyId: string,
    answers: number[],
    idToken: string | undefined,
  ): Promise<SubmitSurveyResponseFetchResult>;
}

function getDefaultGateway(): SubmitSurveyResponseGateway {
  return {
    async submitSurveyResponse(surveyId, answers, idToken) {
      try {
        const response = await fetch(`/api/surveys/${encodeURIComponent(surveyId)}/responses`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ answers }),
        });

        if (response.status === 201) {
          return { status: "ok" };
        }

        const parsed: unknown = await response.json();
        const error =
          typeof parsed === "object" && parsed !== null && "error" in parsed
            ? (parsed as { error: unknown }).error
            : undefined;

        return typeof error === "string" && KNOWN_ERROR_STATUSES.has(error)
          ? { status: error as Exclude<SubmitSurveyResponseFetchResult["status"], "ok"> }
          : { status: "read_failed" };
      } catch {
        return { status: "read_failed" };
      }
    },
  };
}

export interface SubmitSurveyResponseDeps {
  gateway?: SubmitSurveyResponseGateway;
}

/**
 * Submits one respondent's answers to `surveyId` via the thin
 * `POST /api/surveys/{surveyId}/responses` route. `idToken` is forwarded
 * only for the server to verify (`authenticated` mode); a `public` survey
 * never needs one. No authorization/lifecycle decision is made here — the
 * server always re-derives everything fresh (TASK-006).
 */
export async function submitSurveyResponse(
  surveyId: string,
  answers: number[],
  idToken: string | undefined,
  deps: SubmitSurveyResponseDeps = {},
): Promise<SubmitSurveyResponseFetchResult> {
  const gateway = deps.gateway ?? getDefaultGateway();
  return gateway.submitSurveyResponse(surveyId, answers, idToken);
}

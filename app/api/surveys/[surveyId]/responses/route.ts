import { NextResponse } from "next/server";
import { submitSurveyResponse } from "../../../../../src/features/surveys/server/submit-survey-response";

const BEARER_PATTERN = /^Bearer (.+)$/;

const ERROR_STATUS: Record<string, number> = {
  invalid_submission: 400,
  survey_unavailable: 409,
  unauthenticated: 401,
  forbidden: 403,
  already_submitted: 409,
  encryption_failed: 500,
  persistence_failed: 500,
};

/**
 * Thin, unauthenticated-reachable submission endpoint backing
 * `/survey/{surveyId}` (docs/features/managed-surveys/SPEC.md — TASK-006's
 * submission contract). A missing/invalid Authorization header is not
 * itself rejected here — `public` surveys need none;
 * `submitSurveyResponse` resolves a missing/invalid token to
 * `unauthenticated` for `authenticated` surveys, inside its own
 * transaction, on its own. Kept thin; the entire
 * validation/authorization/lifecycle/dedup/encryption decision lives in
 * `submitSurveyResponse`, never here. Never echoes internal detail, a
 * generated document id, or answer content back to the caller (SPEC —
 * "Survey submission contract", step 10).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ surveyId: string }> },
) {
  const { surveyId } = await params;
  const idToken = extractBearerToken(request.headers.get("authorization"));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_submission" }, { status: 400 });
  }

  const answers =
    typeof body === "object" && body !== null && "answers" in body
      ? (body as { answers: unknown }).answers
      : undefined;

  const result = await submitSurveyResponse(surveyId, answers, idToken || undefined);

  if (!result.ok) {
    const status = ERROR_STATUS[result.error] ?? 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

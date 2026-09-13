import { NextResponse } from "next/server";
import { resolveSurveyForParticipation } from "../../../../src/features/surveys/server/resolve-survey-for-participation";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Thin, unauthenticated-reachable read backing `/survey/{surveyId}`
 * (docs/features/managed-surveys/SPEC.md — TASK-007). A missing/invalid
 * Authorization header is not itself rejected here — `public` surveys need
 * none, and `resolveSurveyForParticipation` resolves a missing/invalid
 * token to `sign_in_required` for `authenticated` surveys on its own. Every
 * outcome `resolveSurveyForParticipation` can return is a legitimate
 * application state, not an HTTP error, so every one of them (except an
 * actual read failure) is returned with `200` — orchestration and response
 * minimization both live in `resolveSurveyForParticipation`, not here.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ surveyId: string }> },
) {
  const { surveyId } = await params;
  const idToken = extractBearerToken(request.headers.get("authorization"));

  const result = await resolveSurveyForParticipation(surveyId, idToken || undefined);

  if (!result.ok) {
    return NextResponse.json({ status: "read_failed" }, { status: 500 });
  }

  if (result.status === "not_found" || result.status === "sign_in_required" || result.status === "forbidden") {
    return NextResponse.json({ status: result.status }, { status: 200 });
  }

  return NextResponse.json({ status: result.status, survey: result.survey }, { status: 200 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

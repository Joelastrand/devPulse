import { NextResponse } from "next/server";
import { getSurveyQuestionResults } from "../../../../../../../src/features/surveys/server/get-survey-question-results";
import { type AuthRefusal, authRefusalStatus, isAuthRefusal } from "../../../../../../../src/features/auth/server/auth-refusal";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Per-question results for one closed survey (team-survey-builder TSB-008).
 * Team members and admins only. Authorization and all suppression rules live
 * in `getSurveyQuestionResults`, never here. The route only maps outcomes to
 * HTTP statuses and never returns anything the operation did not publish.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string; surveyId: string }> },
) {
  const { teamId, surveyId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await getSurveyQuestionResults(token, teamId, surveyId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForError(result.error) });
  }

  return NextResponse.json(result, { status: 200 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }
  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

function statusForError(error: AuthRefusal | "forbidden" | "survey_not_found" | "read_failed"): number {
  if (isAuthRefusal(error)) return authRefusalStatus(error);
  if (error === "forbidden") return 403;
  if (error === "survey_not_found") return 404;
  return 500;
}

import { NextResponse } from "next/server";
import { duplicateSurvey, type DuplicateSurveyResult } from "../../../../../../../../src/features/surveys/server/duplicate-survey";
import { authRefusalStatus, isAuthRefusal } from "../../../../../../../../src/features/auth/server/auth-refusal";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only duplication (team-survey-builder TSB-004): `POST` creates a new
 * editable draft copying the source survey's definitions. The copy never
 * carries responses or lifecycle state. Authorization lives in
 * `duplicateSurvey`, which reuses `createSurvey`'s admin and team checks.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ teamId: string; surveyId: string }> },
) {
  const { teamId, surveyId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await duplicateSurvey(token, teamId, surveyId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForError(result.error) });
  }

  return NextResponse.json({ surveyId: result.surveyId }, { status: 200 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }
  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

type DuplicateError = Extract<DuplicateSurveyResult, { ok: false }>["error"];

function statusForError(error: DuplicateError): number {
  if (isAuthRefusal(error)) return authRefusalStatus(error);
  if (error === "forbidden") return 403;
  if (error === "survey_not_found" || error === "team_not_found") return 404;
  if (error === "team_disabled") return 409;
  if (error === "read_failed" || error === "persistence_failed") return 500;
  return 400;
}

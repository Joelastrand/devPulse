import { NextResponse } from "next/server";
import { deleteDraftSurvey } from "../../../../../../../../src/features/surveys/server/delete-draft-survey";
import { type AuthRefusal, authRefusalStatus, isAuthRefusal } from "../../../../../../../../src/features/auth/server/auth-refusal";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only draft deletion (team-survey-builder SPEC — "Draft deletion"):
 * `DELETE` removes an unpublished survey with no responses. Authorization and
 * every refusal rule live in `deleteDraftSurvey`; this route only maps outcomes
 * to HTTP statuses.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ teamId: string; surveyId: string }> },
) {
  const { teamId, surveyId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await deleteDraftSurvey(token, teamId, surveyId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForError(result.error) });
  }

  return NextResponse.json({ outcome: result.outcome }, { status: 200 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }
  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

function statusForError(
  error: AuthRefusal | "forbidden" | "survey_not_found" | "wrong_team" | "not_draft" | "has_responses" | "persistence_failed",
): number {
  if (isAuthRefusal(error)) return authRefusalStatus(error);
  if (error === "forbidden") return 403;
  if (error === "survey_not_found" || error === "wrong_team") return 404;
  if (error === "not_draft" || error === "has_responses") return 409;
  return 500;
}

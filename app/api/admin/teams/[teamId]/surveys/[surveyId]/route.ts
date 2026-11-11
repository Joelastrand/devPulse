import { NextResponse } from "next/server";
import { deleteOrArchiveSurvey } from "../../../../../../../src/features/surveys/server/delete-or-archive-survey";
import { updateSurveyDraft, type UpdateSurveyDraftError } from "../../../../../../../src/features/surveys/server/update-survey-draft";
import { type AuthRefusal, authRefusalStatus, isAuthRefusal } from "../../../../../../../src/features/auth/server/auth-refusal";
const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only survey removal endpoint: `DELETE` permanently deletes a
 * closed, zero-response survey, or archives it if it has one or more
 * responses — the choice is always server-determined
 * (docs/features/managed-surveys/SPEC.md — BR-35, BR-36, BR-37), never a
 * client-supplied action. Kept thin — authorization, the response-count
 * branch, and persistence all live in `deleteOrArchiveSurvey`
 * (`.claude/rules/nextjs-react.md`). `teamId`/`surveyId` come from the URL
 * path but are never trusted as authorization evidence on their own;
 * `deleteOrArchiveSurvey` re-verifies the caller is an app admin and that
 * the survey actually belongs to `teamId` on every call.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ teamId: string; surveyId: string }> },
) {
  const { teamId, surveyId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await deleteOrArchiveSurvey(token, teamId, surveyId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForError(result.error) });
  }

  return NextResponse.json({ outcome: result.outcome }, { status: 200 });
}

/**
 * Admin-only draft editing: `PATCH` updates an unpublished draft's title,
 * description, dates and questions (team-survey-builder TSB-005). Refused with
 * `not_editable` once the survey is opened, closed or archived, so published
 * question definitions are frozen. Authorization lives in `updateSurveyDraft`.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ teamId: string; surveyId: string }> },
) {
  const { teamId, surveyId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const result = await updateSurveyDraft(token, teamId, surveyId, body);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForUpdateError(result.error) });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

function statusForUpdateError(error: UpdateSurveyDraftError): number {
  if (isAuthRefusal(error)) return authRefusalStatus(error);
  if (error === "forbidden") return 403;
  if (error === "survey_not_found") return 404;
  if (error === "not_editable") return 409;
  if (error === "persistence_failed") return 500;
  return 400;
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

function statusForError(
  error: AuthRefusal | "forbidden" | "survey_not_found" | "wrong_team" | "not_closed" | "persistence_failed",
): number {
  if (isAuthRefusal(error)) return authRefusalStatus(error);
  if (error === "forbidden") return 403;
  if (error === "survey_not_found" || error === "wrong_team") return 404;
  if (error === "not_closed") return 409;
  return 500;
}

import { NextResponse } from "next/server";
import { deleteOrArchiveSurvey } from "../../../../../../../src/features/surveys/server/delete-or-archive-survey";

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

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

function statusForError(
  error: "unauthenticated" | "forbidden" | "survey_not_found" | "wrong_team" | "not_closed" | "persistence_failed",
): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  if (error === "survey_not_found" || error === "wrong_team") return 404;
  if (error === "not_closed") return 409;
  return 500;
}

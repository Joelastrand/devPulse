import { NextResponse } from "next/server";
import { openSurvey } from "../../../../../../../../src/features/surveys/server/open-survey";
import { type AuthRefusal, authRefusalStatus, isAuthRefusal } from "../../../../../../../../src/features/auth/server/auth-refusal";
const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only survey-open endpoint (docs/archive/features/managed-surveys/SPEC.md —
 * BR-5, BR-6). Kept thin — authorization, the one-open-survey-per-team
 * transaction, and every rejection reason live in `openSurvey`
 * (`.claude/rules/nextjs-react.md`); this route duplicates none of that
 * decision logic. `teamId`/`surveyId` come from the URL path but are never
 * trusted as authorization evidence on their own.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ teamId: string; surveyId: string }> },
) {
  const { teamId, surveyId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await openSurvey(token, teamId, surveyId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForError(result.error) });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

function statusForError(
  error:
    | AuthRefusal
    | "forbidden"
    | "survey_not_found"
    | "wrong_team"
    | "not_scheduled"
    | "team_not_found"
    | "team_disabled"
    | "team_already_has_open_survey"
    | "invalid_coordination_state"
    | "persistence_failed",
): number {
  if (isAuthRefusal(error)) return authRefusalStatus(error);
  if (error === "forbidden") return 403;
  if (error === "survey_not_found" || error === "wrong_team" || error === "team_not_found") return 404;
  if (
    error === "not_scheduled" ||
    error === "team_disabled" ||
    error === "team_already_has_open_survey" ||
    error === "invalid_coordination_state"
  ) {
    return 409;
  }
  return 500;
}

import { NextResponse } from "next/server";
import { listTeamResultsSurveys } from "../../../../../src/features/surveys/server/list-team-results-surveys";
import { type AuthRefusal, authRefusalStatus, isAuthRefusal } from "../../../../../src/features/auth/server/auth-refusal";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * `GET` lists the team's closed configurable surveys that have per-question
 * results (team-survey-builder TSB-008). Team members and app admins only.
 * Authorization and the closed/configurable filter live in
 * `listTeamResultsSurveys`.
 */
export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await listTeamResultsSurveys(token, teamId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForError(result.error) });
  }

  return NextResponse.json({ ok: true, surveys: result.surveys }, { status: 200 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }
  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

function statusForError(error: AuthRefusal | "forbidden" | "read_failed"): number {
  if (isAuthRefusal(error)) return authRefusalStatus(error);
  if (error === "forbidden") return 403;
  return 500;
}

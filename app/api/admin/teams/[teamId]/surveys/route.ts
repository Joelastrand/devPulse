import { NextResponse } from "next/server";
import { createSurvey } from "../../../../../../src/features/surveys/server/create-survey";
import { listTeamSurveys } from "../../../../../../src/features/surveys/server/list-team-surveys";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only survey-management endpoint for one team: `GET` lists the
 * team's surveys (docs/features/managed-surveys/SPEC.md — BR-33), `POST`
 * creates a new one, always scoped to this route's own `teamId` (BR-34).
 * Kept thin — authorization, team-active checks, and persistence all live
 * in `listTeamSurveys`/`createSurvey` (`.claude/rules/nextjs-react.md`).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await listTeamSurveys(token, teamId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForListError(result.error) });
  }

  return NextResponse.json({ surveys: result.surveys }, { status: 200 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const result = await createSurvey(token, teamId, body);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForCreateError(result.error) });
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

function statusForListError(error: "unauthenticated" | "forbidden" | "read_failed"): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  return 500;
}

function statusForCreateError(
  error:
    | "unauthenticated"
    | "forbidden"
    | "invalid_input"
    | "invalid_access_mode"
    | "invalid_minimum_responses"
    | "invalid_title"
    | "invalid_start_at"
    | "invalid_end_at"
    | "invalid_date_range"
    | "team_not_found"
    | "team_disabled"
    | "persistence_failed",
): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  if (error === "team_not_found") return 404;
  if (error === "team_disabled") return 409;
  if (error.startsWith("invalid_")) return 400;
  return 500;
}

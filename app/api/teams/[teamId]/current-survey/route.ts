import { NextResponse } from "next/server";
import { getCurrentTeamSurvey } from "../../../../../src/features/surveys/server/get-current-team-survey";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * `/teams/[teamId]`'s "Pågående undersøkelse" section read
 * (docs/features/managed-surveys/SPEC.md — TASK-010). `teamId` comes from
 * the URL path but is never trusted as authorization evidence on its own —
 * `getCurrentTeamSurvey` always re-derives access via `authorizeTeamAccess`
 * before any survey data is read. Kept thin; orchestration and lifecycle/
 * team-disable derivation live in `getCurrentTeamSurvey`. Deliberately a
 * separate endpoint from `/api/teams/[teamId]/results` — survey discovery
 * and protected results stay separate server contracts.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await getCurrentTeamSurvey(token, teamId);

  if (!result.ok) {
    const status =
      result.error === "unauthenticated" ? 401 : result.error === "forbidden" ? 403 : 500;
    return NextResponse.json({ status: result.error }, { status });
  }

  return NextResponse.json({ status: "ok", survey: result.survey }, { status: 200 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

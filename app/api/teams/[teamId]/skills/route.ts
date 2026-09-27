import { NextResponse } from "next/server";
import { getTeamSkillProgress } from "../../../../../src/features/skill-trees/server/get-team-skill-progress";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * `/teams/[teamId]`'s member-facing read-only skill endpoint
 * (docs/features/team-skill-tree/SPEC.md — TASK-007, BR-28 through BR-30).
 * `GET` is a thin delegate to `getTeamSkillProgress` — `teamId` comes from
 * the URL path only and is never trusted as authorization evidence on its
 * own; every authorization/read decision lives in the delegated server
 * operation, never here (`.claude/rules/nextjs-react.md`,
 * `.claude/rules/security.md`). This task must not implement any
 * authorization or team-scoping logic of its own.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await getTeamSkillProgress(token, teamId);

  if (!result.ok) {
    const status =
      result.error === "unauthenticated" ? 401 : result.error === "forbidden" ? 403 : 500;
    return NextResponse.json({ status: result.error }, { status });
  }

  return NextResponse.json(
    { status: "ok", skills: result.skills, canReportProgress: result.canReportProgress },
    { status: 200 },
  );
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

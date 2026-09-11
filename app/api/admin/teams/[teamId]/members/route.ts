import { NextResponse } from "next/server";
import { listTeamMembers } from "../../../../../../src/features/teams/server/list-team-members";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only team member list endpoint. Kept thin — authorization and the
 * live email lookup live in `listTeamMembers`
 * (`.claude/rules/nextjs-react.md`).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await listTeamMembers(token, teamId);

  if (!result.ok) {
    const status =
      result.error === "unauthenticated"
        ? 401
        : result.error === "forbidden"
          ? 403
          : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ members: result.members }, { status: 200 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

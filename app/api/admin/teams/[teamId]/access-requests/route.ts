import { NextResponse } from "next/server";
import { listTeamAccessRequests } from "../../../../../../src/features/teams/server/list-team-access-requests";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only pending access-request list endpoint. Kept thin —
 * authorization and the live email lookup live in `listTeamAccessRequests`
 * (`.claude/rules/nextjs-react.md`).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await listTeamAccessRequests(token, teamId);

  if (!result.ok) {
    const status =
      result.error === "unauthenticated"
        ? 401
        : result.error === "forbidden"
          ? 403
          : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ requests: result.requests }, { status: 200 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

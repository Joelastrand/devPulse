import { NextResponse } from "next/server";
import { listAssignableMembers } from "../../../../../src/features/teams/server/list-assignable-members";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Owner-selection contract for roadmap planning (docs/features/
 * team-skill-planning/SPEC.md — BR-4). `GET` is a thin delegate to
 * `listAssignableMembers`; `teamId` comes from the URL path only and every
 * authorization/read decision lives in the delegated operation. The response
 * is built field by field from the operation's result — never a `uid`,
 * e-mail, join date or role. Separate from, and never merged with, the F0
 * roster (`/api/teams/[teamId]/members`). Read-only: no other method exported.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await listAssignableMembers(token, teamId);

  if (!result.ok) {
    const status =
      result.error === "unauthenticated" ? 401 : result.error === "forbidden" ? 403 : 500;
    return NextResponse.json({ status: result.error }, { status });
  }

  return NextResponse.json(
    {
      members: result.members.map(({ memberRef, displayName, ordinal, isSelf }) => ({
        memberRef,
        displayName,
        ordinal,
        isSelf,
      })),
      unavailableCount: result.unavailableCount,
      truncated: result.truncated,
    },
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

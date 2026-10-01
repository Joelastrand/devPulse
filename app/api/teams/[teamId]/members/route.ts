import { NextResponse } from "next/server";
import { listTeamRoster } from "../../../../../src/features/teams/server/list-team-roster";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * `/teams/[teamId]`'s member-facing roster endpoint (docs/features/
 * member-identity-and-team-roles/SPEC.md — BR-8 through BR-15). `GET` is a
 * thin delegate to `listTeamRoster` — `teamId` comes from the URL path only
 * and is never trusted as authorization evidence on its own; every
 * authorization/read decision lives in the delegated server operation
 * (`.claude/rules/nextjs-react.md`, `.claude/rules/security.md`). The
 * response is built from the operation's result alone and contains only
 * `{status, members: [{displayName, isLead, isSelf}], truncated}` — never a
 * `uid`, e-mail or any other identity field (a Forum `authorTag` is
 * computable from a `uid`). Distinct from, and not a replacement for, the
 * app-admin-only `/api/admin/teams/[teamId]/members`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await listTeamRoster(token, teamId);

  if (!result.ok) {
    const status =
      result.error === "unauthenticated" ? 401 : result.error === "forbidden" ? 403 : 500;
    return NextResponse.json({ status: result.error }, { status });
  }

  return NextResponse.json(
    {
      status: "ok",
      members: result.members.map(({ displayName, isLead, isSelf }) => ({ displayName, isLead, isSelf })),
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

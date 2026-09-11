import { NextResponse } from "next/server";
import { removeTeamMember } from "../../../../../../../src/features/teams/server/remove-team-member";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only team member removal endpoint. Kept thin — authorization and
 * persistence live in `removeTeamMember`
 * (`.claude/rules/nextjs-react.md`). `teamId`/`uid` come from the URL path
 * but are never trusted as authorization evidence on their own;
 * `removeTeamMember` re-verifies the caller is an app admin on every call.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ teamId: string; uid: string }> },
) {
  const { teamId, uid } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await removeTeamMember(token, teamId, uid);

  if (!result.ok) {
    const status =
      result.error === "unauthenticated"
        ? 401
        : result.error === "forbidden"
          ? 403
          : 500;
    return NextResponse.json({ error: result.error }, { status });
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

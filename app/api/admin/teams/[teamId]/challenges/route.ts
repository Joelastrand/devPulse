import { NextResponse } from "next/server";
import { listTeamChallengesForAdmin } from "../../../../../../src/features/challenges/server/list-team-challenges";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * `/admin/teams/[teamId]`'s admin-only challenge list endpoint
 * (docs/features/anonymous-challenges/SPEC.md — TASK-006, BR-35). `GET`
 * always delegates to `listTeamChallengesForAdmin` — a genuinely separate
 * operation (and route) from TASK-005's member-facing
 * `app/api/teams/[teamId]/challenges/route.ts`, never the same one
 * re-grouped or gated by a client-supplied flag. Kept thin: `teamId` comes
 * from the URL path but is never trusted as authorization evidence on its
 * own — every authorization/lifecycle/decryption decision lives in
 * `listTeamChallengesForAdmin` (`.claude/rules/nextjs-react.md`,
 * `.claude/rules/security.md`).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await listTeamChallengesForAdmin(token, teamId);

  if (!result.ok) {
    const status =
      result.error === "unauthenticated" ? 401 : result.error === "forbidden" ? 403 : 500;
    return NextResponse.json({ status: result.error }, { status });
  }

  return NextResponse.json({ status: "ok", challenges: result.challenges }, { status: 200 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

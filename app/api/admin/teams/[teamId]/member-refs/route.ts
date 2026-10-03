import { NextResponse } from "next/server";
import { materializeMemberRefs } from "../../../../../../src/features/teams/server/materialize-member-refs";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only member-ref preparation endpoint (docs/features/team-skill-
 * planning/SPEC.md — BR-3). Kept thin — authorization, the transaction and
 * every rule live in `materializeMemberRefs`. The request takes no body (none
 * is ever read) and `teamId` comes from the path but is never authorization
 * evidence; the operation re-verifies the caller is an app admin.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await materializeMemberRefs(token, teamId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusFor(result.error) });
  }

  return NextResponse.json(
    { materialized: result.materialized, alreadyHad: result.alreadyHad, truncated: result.truncated },
    { status: 200 },
  );
}

function statusFor(error: "unauthenticated" | "forbidden" | "team_not_found" | "persistence_failed"): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  if (error === "team_not_found") return 404;
  return 500;
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

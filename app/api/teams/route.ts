import { NextResponse } from "next/server";
import { getTeamsOverview } from "../../../src/features/teams/server/get-teams-overview";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * The `/teams` overview endpoint (docs/features/team-management/SPEC.md —
 * BR-11 through BR-13). Kept thin — authorization, invitation resolution,
 * and relationship computation all live in `getTeamsOverview`. Identity
 * comes only from the verified bearer token, never a client-supplied
 * uid/email/admin flag.
 */
export async function GET(request: Request) {
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await getTeamsOverview(token);

  if (!result.ok) {
    const status = result.error === "unauthenticated" ? 401 : 500;
    return NextResponse.json({ status: result.error }, { status });
  }

  return NextResponse.json({ status: "ok", teams: result.teams }, { status: 200 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

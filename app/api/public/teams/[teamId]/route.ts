import { NextResponse } from "next/server";
import { getPublicTeam } from "../../../../../src/features/teams/server/get-public-team";

/**
 * Anonymous read of one public team (docs/archive/features/teamadmin-and-team-visibility/SPEC.md). No authentication is read and
 * none is required. The response is the explicit `{team: {teamId, name}}` projection only. A private, disabled or
 * unknown team is the same `404`. Never cached, so a visibility change takes effect on the next request.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const result = await getPublicTeam(teamId);

  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 500;
    return NextResponse.json({ error: result.error }, { status, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(
    { team: { teamId: result.team.teamId, name: result.team.name } },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

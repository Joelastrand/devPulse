import { NextResponse } from "next/server";
import { createGetTeamOwnedSkillAggregate } from "../../../../../../src/features/team-owned-skills/server/get-team-owned-skill-aggregate";
import { extractBearerToken, teamSkillErrorResponse } from "../../../../../../src/features/team-owned-skills/server/team-skill-http";

const getTeamOwnedSkillAggregate = createGetTeamOwnedSkillAggregate();

/** Team-level status of the team's active skills (threshold SKILL_COVERAGE_MIN_CONTRIBUTORS, opted-in contributors only). Members only; no individual data. */
export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const result = await getTeamOwnedSkillAggregate(extractBearerToken(request.headers.get("authorization")), teamId);
  if (!result.ok) return teamSkillErrorResponse(result.error);
  return NextResponse.json({ availability: result.availability, rows: result.rows }, { status: 200 });
}

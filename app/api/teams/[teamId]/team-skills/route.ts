import { NextResponse } from "next/server";
import { createTeamSkill, listTeamSkills } from "../../../../../src/features/team-owned-skills/server/manage-team-skills";
import {
  extractBearerToken,
  readJsonBody,
  teamSkillErrorResponse,
} from "../../../../../src/features/team-owned-skills/server/team-skill-http";

/** The team's own skill definitions, the caller's own ratings and `canEdit`. No other person's rating is returned. */
export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const result = await listTeamSkills(extractBearerToken(request.headers.get("authorization")), teamId);
  if (!result.ok) return teamSkillErrorResponse(result.error);
  return NextResponse.json(
    { skills: result.skills, canEdit: result.canEdit, own: result.own, truncated: result.truncated },
    { status: 200 },
  );
}

/** Creates a team skill. Administrators of an active team only. */
export async function POST(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const body = await readJsonBody(request);
  const result = await createTeamSkill(extractBearerToken(request.headers.get("authorization")), teamId, body);
  if (!result.ok) return teamSkillErrorResponse(result.error);
  return NextResponse.json({ skill: result.skill }, { status: 201 });
}

import { NextResponse } from "next/server";
import { updateTeamSkill } from "../../../../../../src/features/team-owned-skills/server/manage-team-skills";
import {
  extractBearerToken,
  readJsonBody,
  teamSkillErrorResponse,
} from "../../../../../../src/features/team-owned-skills/server/team-skill-http";

/** Edits a team skill, including activation and deactivation. Administrators of an active team only. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ teamId: string; skillId: string }> },
) {
  const { teamId, skillId } = await params;
  const body = await readJsonBody(request);
  const result = await updateTeamSkill(extractBearerToken(request.headers.get("authorization")), teamId, skillId, body);
  if (!result.ok) return teamSkillErrorResponse(result.error);
  return NextResponse.json({ skill: result.skill }, { status: 200 });
}

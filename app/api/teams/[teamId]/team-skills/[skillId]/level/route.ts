import { NextResponse } from "next/server";
import {
  clearOwnTeamSkillLevel,
  setOwnTeamSkillLevel,
} from "../../../../../../../src/features/team-owned-skills/server/manage-team-skills";
import {
  extractBearerToken,
  readJsonBody,
  teamSkillErrorResponse,
} from "../../../../../../../src/features/team-owned-skills/server/team-skill-http";

/** Sets the caller's own rating of an active team skill. Genuine members of an active team only. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ teamId: string; skillId: string }> },
) {
  const { teamId, skillId } = await params;
  const body = await readJsonBody(request);
  const result = await setOwnTeamSkillLevel(extractBearerToken(request.headers.get("authorization")), teamId, skillId, body);
  if (!result.ok) return teamSkillErrorResponse(result.error);
  return NextResponse.json({ skillId: result.skillId, level: result.level, criteriaVersion: result.criteriaVersion }, { status: 200 });
}

/** Clears the caller's own rating of an active team skill. Idempotent. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ teamId: string; skillId: string }> },
) {
  const { teamId, skillId } = await params;
  const result = await clearOwnTeamSkillLevel(extractBearerToken(request.headers.get("authorization")), teamId, skillId);
  if (!result.ok) return teamSkillErrorResponse(result.error);
  return NextResponse.json({ skillId: result.skillId, cleared: result.cleared }, { status: 200 });
}

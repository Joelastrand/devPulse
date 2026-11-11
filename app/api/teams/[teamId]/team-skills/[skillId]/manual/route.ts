import { NextResponse } from "next/server";
import {
  clearTeamManualAssessment,
  setTeamManualAssessment,
} from "../../../../../../../src/features/team-owned-skills/server/manage-team-manual-assessments";
import {
  extractBearerToken,
  readJsonBody,
  teamSkillErrorResponse,
} from "../../../../../../../src/features/team-owned-skills/server/team-skill-http";

/** Records the team's agreed level for one active skill. Team administrators only. */
export async function PUT(request: Request, { params }: { params: Promise<{ teamId: string; skillId: string }> }) {
  const { teamId, skillId } = await params;
  const body = await readJsonBody(request);
  const result = await setTeamManualAssessment(extractBearerToken(request.headers.get("authorization")), teamId, skillId, body);
  if (!result.ok) return teamSkillErrorResponse(result.error);
  return NextResponse.json({ skillId: result.skillId, level: result.level, criteriaVersion: result.criteriaVersion }, { status: 200 });
}

/** Removes the team's agreed level for one skill. Team administrators only. Idempotent. */
export async function DELETE(request: Request, { params }: { params: Promise<{ teamId: string; skillId: string }> }) {
  const { teamId, skillId } = await params;
  const result = await clearTeamManualAssessment(extractBearerToken(request.headers.get("authorization")), teamId, skillId);
  if (!result.ok) return teamSkillErrorResponse(result.error);
  return NextResponse.json({ skillId: result.skillId, cleared: result.cleared }, { status: 200 });
}

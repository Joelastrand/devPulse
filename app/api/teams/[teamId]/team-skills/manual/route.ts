import { NextResponse } from "next/server";
import { listTeamManualAssessments } from "../../../../../../src/features/team-owned-skills/server/manage-team-manual-assessments";
import { extractBearerToken, teamSkillErrorResponse } from "../../../../../../src/features/team-owned-skills/server/team-skill-http";

/** The team's collaborative (agreed) levels for its active skills. Members and administrators only; no member data. */
export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const result = await listTeamManualAssessments(extractBearerToken(request.headers.get("authorization")), teamId);
  if (!result.ok) return teamSkillErrorResponse(result.error);
  return NextResponse.json({ canEdit: result.canEdit, assessments: result.assessments }, { status: 200 });
}

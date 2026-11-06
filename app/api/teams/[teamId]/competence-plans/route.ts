import { NextResponse } from "next/server";
import { listCompetencePlans } from "../../../../../src/features/team-competence-plan/server/competence-plans";
import { competencePlanErrorResponse } from "../../../../../src/features/team-competence-plan/server/competence-plan-http";
import { extractBearerToken } from "../../../../../src/features/team-competence-catalog/server/competence-area-http";

/** Team competence development plans (SPEC — BR-15, BR-16). Members read; no ratings or member data are returned. */
export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const includeArchived = new URL(request.url).searchParams.get("archived") === "true";
  const result = await listCompetencePlans(token, teamId, { includeArchived });
  if (!result.ok) return competencePlanErrorResponse(result.error);
  return NextResponse.json({ plans: result.plans, canEdit: result.canEdit, truncated: result.truncated }, { status: 200 });
}

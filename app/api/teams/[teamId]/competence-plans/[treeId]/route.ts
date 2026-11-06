import { NextResponse } from "next/server";
import { upsertCompetencePlan } from "../../../../../../src/features/team-competence-plan/server/competence-plans";
import { competencePlanErrorResponse } from "../../../../../../src/features/team-competence-plan/server/competence-plan-http";
import {
  extractBearerToken,
  readJsonBody,
} from "../../../../../../src/features/team-competence-catalog/server/competence-area-http";

/** Creates or replaces the plan for one assigned area (SPEC — BR-15). Lead of an active team only. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ teamId: string; treeId: string }> },
) {
  const { teamId, treeId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const body = await readJsonBody(request);
  const result = await upsertCompetencePlan(token, teamId, treeId, body);
  if (!result.ok) return competencePlanErrorResponse(result.error, result.issues);
  return NextResponse.json({ plan: result.plan }, { status: 200 });
}

import { NextResponse } from "next/server";
import { updateCompetencePlan } from "../../../../../../src/features/team-competence-plan/server/competence-plans";
import { competencePlanErrorResponse } from "../../../../../../src/features/team-competence-plan/server/competence-plan-http";
import {
  extractBearerToken,
  readJsonBody,
} from "../../../../../../src/features/team-competence-plan/server/plan-http-request";

/** Replaces the editable fields of one plan (SPEC — BR-15). Lead of an active team only. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ teamId: string; planId: string }> },
) {
  const { teamId, planId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const body = await readJsonBody(request);
  const result = await updateCompetencePlan(token, teamId, planId, body);
  if (!result.ok) return competencePlanErrorResponse(result.error, result.issues);
  return NextResponse.json({ plan: result.plan }, { status: 200 });
}

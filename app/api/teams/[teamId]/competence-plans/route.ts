import { NextResponse } from "next/server";
import { createCompetencePlan, listCompetencePlans } from "../../../../../src/features/team-competence-plan/server/competence-plans";
import { competencePlanErrorResponse } from "../../../../../src/features/team-competence-plan/server/competence-plan-http";
import {
  extractBearerToken,
  readJsonBody,
} from "../../../../../src/features/team-competence-plan/server/plan-http-request";

/** Team competence development plans (SPEC — BR-15, BR-16). Members read; no ratings or member data are returned. */
export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const includeArchived = new URL(request.url).searchParams.get("archived") === "true";
  const result = await listCompetencePlans(token, teamId, { includeArchived });
  if (!result.ok) return competencePlanErrorResponse(result.error);
  return NextResponse.json({ plans: result.plans, canEdit: result.canEdit, truncated: result.truncated }, { status: 200 });
}

/** Creates a plan with no competence area required. Lead of an active team only. */
export async function POST(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const body = await readJsonBody(request);
  const result = await createCompetencePlan(token, teamId, body);
  if (!result.ok) return competencePlanErrorResponse(result.error, result.issues);
  return NextResponse.json({ plan: result.plan }, { status: 201 });
}

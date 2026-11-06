import { NextResponse } from "next/server";
import { reorderCompetenceAreas } from "../../../../../../src/features/team-competence-catalog/server/manage-competence-areas";
import {
  competenceAreaErrorResponse,
  extractBearerToken,
  readJsonBody,
} from "../../../../../../src/features/team-competence-catalog/server/competence-area-http";

/** Replaces the order of the team's non-archived assignments (SPEC — BR-18). Lead of an active team only. */
export async function PUT(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const body = await readJsonBody(request);
  const result = await reorderCompetenceAreas(token, teamId, body);
  if (!result.ok) return competenceAreaErrorResponse(result.error);
  return NextResponse.json({ order: result.order }, { status: 200 });
}

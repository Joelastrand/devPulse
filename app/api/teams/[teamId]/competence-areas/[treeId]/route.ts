import { NextResponse } from "next/server";
import { setCompetenceAreaStatus } from "../../../../../../src/features/team-competence-catalog/server/manage-competence-areas";
import {
  competenceAreaErrorResponse,
  extractBearerToken,
  readJsonBody,
} from "../../../../../../src/features/team-competence-catalog/server/competence-area-http";

/** Activate, deactivate or archive one assignment (SPEC — BR-18). Lead of an active team only. */
export async function PATCH(request: Request, { params }: { params: Promise<{ teamId: string; treeId: string }> }) {
  const { teamId, treeId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const body = await readJsonBody(request);
  const result = await setCompetenceAreaStatus(token, teamId, treeId, body);
  if (!result.ok) return competenceAreaErrorResponse(result.error);
  return NextResponse.json({ area: result.area }, { status: 200 });
}

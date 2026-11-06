import { NextResponse } from "next/server";
import { assignCompetenceArea, listCompetenceAreas } from "../../../../../src/features/team-competence-catalog/server/manage-competence-areas";
import {
  competenceAreaErrorResponse,
  extractBearerToken,
  readJsonBody,
} from "../../../../../src/features/team-competence-catalog/server/competence-area-http";

/** Team competence areas in order (SPEC — BR-18). Members read; no ratings are returned. */
export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const includeArchived = new URL(request.url).searchParams.get("archived") === "true";
  const result = await listCompetenceAreas(token, teamId, { includeArchived });
  if (!result.ok) return competenceAreaErrorResponse(result.error);
  return NextResponse.json({ areas: result.areas, canEdit: result.canEdit, truncated: result.truncated }, { status: 200 });
}

/** Assigns one catalog area to the team (SPEC — BR-18). Lead of an active team only. */
export async function POST(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const body = await readJsonBody(request);
  const result = await assignCompetenceArea(token, teamId, body);
  if (!result.ok) return competenceAreaErrorResponse(result.error);
  return NextResponse.json({ area: result.area }, { status: 201 });
}

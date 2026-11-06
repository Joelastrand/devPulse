import { NextResponse } from "next/server";
import { listProjectParticipations } from "../../../../../../../src/features/team-projects/server/list-project-participations";
import { writeProjectParticipation } from "../../../../../../../src/features/team-projects/server/write-project-participation";
import {
  extractBearerToken,
  isValidProjectIdSegment,
  participationWriteResponse,
  readJsonBody,
  teamProjectErrorStatus,
} from "../../../../../../../src/features/team-projects/server/http";

/** Participation list for one project (SPEC — BR-8, BR-12, BR-13). `teamId` and `projectId` come from the path only. */
export async function GET(request: Request, { params }: { params: Promise<{ teamId: string; projectId: string }> }) {
  const { teamId, projectId } = await params;
  if (!isValidProjectIdSegment(projectId)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const token = extractBearerToken(request.headers.get("authorization"));
  const includeArchived = new URL(request.url).searchParams.get("archived") === "true";
  const result = await listProjectParticipations(token, teamId, projectId, { includeArchived });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: teamProjectErrorStatus(result.error) });
  }
  return NextResponse.json(
    { participations: result.participations, canEdit: result.canEdit, truncated: result.truncated },
    { status: 200 },
  );
}

/** Participation creation (SPEC — BR-8). Lead of an active team only. Unparsable JSON is `invalid_request`. */
export async function POST(request: Request, { params }: { params: Promise<{ teamId: string; projectId: string }> }) {
  const { teamId, projectId } = await params;
  if (!isValidProjectIdSegment(projectId)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const token = extractBearerToken(request.headers.get("authorization"));
  const body = await readJsonBody(request);

  return participationWriteResponse(await writeProjectParticipation(token, teamId, projectId, "create", null, body), 201);
}

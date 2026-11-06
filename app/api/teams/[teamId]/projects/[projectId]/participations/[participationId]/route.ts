import { NextResponse } from "next/server";
import { writeProjectParticipation } from "../../../../../../../../src/features/team-projects/server/write-project-participation";
import {
  extractBearerToken,
  isValidProjectIdSegment,
  participationWriteResponse,
  readJsonBody,
} from "../../../../../../../../src/features/team-projects/server/http";

/** Participation update: dates and note only (SPEC — BR-8). Lead of an active team only. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ teamId: string; projectId: string; participationId: string }> },
) {
  const { teamId, projectId, participationId } = await params;
  if (!isValidProjectIdSegment(projectId) || !isValidProjectIdSegment(participationId)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const token = extractBearerToken(request.headers.get("authorization"));
  const body = await readJsonBody(request);

  return participationWriteResponse(
    await writeProjectParticipation(token, teamId, projectId, "update", participationId, body),
    200,
  );
}

/** Participation removal: a soft archive, so the record is kept out of planning views (SPEC — BR-8). Lead only. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ teamId: string; projectId: string; participationId: string }> },
) {
  const { teamId, projectId, participationId } = await params;
  if (!isValidProjectIdSegment(projectId) || !isValidProjectIdSegment(participationId)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const token = extractBearerToken(request.headers.get("authorization"));

  return participationWriteResponse(
    await writeProjectParticipation(token, teamId, projectId, "remove", participationId, undefined),
    200,
  );
}

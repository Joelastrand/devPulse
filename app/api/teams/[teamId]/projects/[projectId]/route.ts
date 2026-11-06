import { NextResponse } from "next/server";
import { writeTeamProject } from "../../../../../../src/features/team-projects/server/write-team-project";
import {
  extractBearerToken,
  isValidProjectIdSegment,
  readJsonBody,
  teamProjectWriteResponse,
} from "../../../../../../src/features/team-projects/server/http";

/** Project update (SPEC — BR-6). Lead of an active team only; archived projects must be restored first. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ teamId: string; projectId: string }> },
) {
  const { teamId, projectId } = await params;
  if (!isValidProjectIdSegment(projectId)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const token = extractBearerToken(request.headers.get("authorization"));
  const body = await readJsonBody(request);

  return teamProjectWriteResponse(await writeTeamProject(token, teamId, "update", projectId, body), 200);
}

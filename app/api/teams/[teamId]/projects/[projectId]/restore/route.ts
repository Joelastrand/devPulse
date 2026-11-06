import { NextResponse } from "next/server";
import { writeTeamProject } from "../../../../../../../src/features/team-projects/server/write-team-project";
import {
  extractBearerToken,
  isValidProjectIdSegment,
  teamProjectWriteResponse,
} from "../../../../../../../src/features/team-projects/server/http";

/** Restores an archived project (SPEC — BR-6). Lead of an active team only. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ teamId: string; projectId: string }> },
) {
  const { teamId, projectId } = await params;
  if (!isValidProjectIdSegment(projectId)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const token = extractBearerToken(request.headers.get("authorization"));

  return teamProjectWriteResponse(await writeTeamProject(token, teamId, "restore", projectId, undefined), 200);
}

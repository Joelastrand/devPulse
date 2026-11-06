import { NextResponse } from "next/server";
import { listTeamProjects } from "../../../../../src/features/team-projects/server/list-team-projects";
import { writeTeamProject } from "../../../../../src/features/team-projects/server/write-team-project";
import {
  extractBearerToken,
  readJsonBody,
  teamProjectErrorStatus,
  teamProjectWriteResponse,
} from "../../../../../src/features/team-projects/server/http";

/** Team project read (SPEC — BR-6, BR-14). `teamId` comes from the path only; all decisions live in the gateway. */
export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const includeArchived = new URL(request.url).searchParams.get("archived") === "true";
  const result = await listTeamProjects(token, teamId, { includeArchived });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: teamProjectErrorStatus(result.error) });
  }
  return NextResponse.json(
    { projects: result.projects, canEdit: result.canEdit, truncated: result.truncated },
    { status: 200 },
  );
}

/** Project creation (SPEC — BR-6). Lead of an active team only. Unparsable JSON is `invalid_request`. */
export async function POST(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const body = await readJsonBody(request);

  return teamProjectWriteResponse(await writeTeamProject(token, teamId, "create", null, body), 201);
}

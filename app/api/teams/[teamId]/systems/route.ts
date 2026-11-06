import { NextResponse } from "next/server";
import { listTeamSystems } from "../../../../../src/features/team-systems/server/list-team-systems";
import { writeTeamSystem } from "../../../../../src/features/team-systems/server/write-team-system";
import { authRefusalStatus, isAuthRefusal } from "../../../../../src/features/auth/server/auth-refusal";
import { extractBearerToken, WRITE_STATUS } from "../../../../../src/features/team-systems/server/http";

/**
 * Team system list (docs/features/team-system-overview/SPEC.md — BR-2).
 * Thin delegate: `teamId` comes from the URL path only; every decision lives in
 * `listTeamSystems`. Responses carry error codes only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await listTeamSystems(token, teamId);

  if (!result.ok) {
    const status =
      isAuthRefusal(result.error) ? authRefusalStatus(result.error) : result.error === "forbidden" ? 403 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(
    { systems: result.systems, canEdit: result.canEdit, truncated: result.truncated },
    { status: 200 },
  );
}

/** System creation (BR-4). Unparsable JSON is `invalid_request`. No DELETE method is exported. */
export async function POST(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const body = await readBody(request);

  const result = await writeTeamSystem(token, teamId, null, body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: WRITE_STATUS[result.error] ?? 500 });
  }
  return NextResponse.json({ systemId: result.systemId }, { status: 201 });
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

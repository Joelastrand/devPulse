import { NextResponse } from "next/server";
import { writeTeamSystem } from "../../../../../../src/features/team-systems/server/write-team-system";
import { extractBearerToken, WRITE_STATUS } from "../../../../../../src/features/team-systems/server/http";

/**
 * Update of one team system (BR-5). Partial update semantics are defined in
 * `parseTeamSystemInput`; both ids come from the URL path and are verified
 * server-side. No DELETE method is exported (D-8).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ teamId: string; systemId: string }> },
) {
  const { teamId, systemId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }

  const result = await writeTeamSystem(token, teamId, systemId, body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: WRITE_STATUS[result.error] ?? 500 });
  }
  return NextResponse.json({ systemId: result.systemId }, { status: 200 });
}

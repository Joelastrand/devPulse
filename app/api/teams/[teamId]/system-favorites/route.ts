import { NextResponse } from "next/server";
import { listSystemFavorites } from "../../../../../src/features/team-systems/server/system-favorites";
import { extractBearerToken, WRITE_STATUS } from "../../../../../src/features/team-systems/server/http";

/**
 * The caller's own system favorites in one team (Phase 2F.1). `teamId` comes from the path; the caller is identified by the
 * verified bearer token only. Responses carry the favorite system ids and error codes, never business data.
 */
export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await listSystemFavorites(token, teamId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: WRITE_STATUS[result.error] ?? 500 });
  }
  return NextResponse.json({ systemIds: result.systemIds }, { status: 200 });
}

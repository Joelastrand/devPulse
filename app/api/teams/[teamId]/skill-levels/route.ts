import { NextResponse } from "next/server";
import { toTeamSkillLevelsDto } from "../../../../../src/features/team-skills/domain/team-skill-levels-dto";
import { getTeamSkillLevels } from "../../../../../src/features/team-skills/server/get-team-skill-coverage";

const BEARER_PATTERN = /^Bearer (.+)$/;
const NO_STORE = { "Cache-Control": "no-store" };

const STATUS: Record<string, number> = {
  unauthenticated: 401,
  erasure_in_progress: 403,
  auth_unavailable: 503,
  forbidden: 403,
  team_disabled: 409,
  read_failed: 500,
};

/**
 * Automatic numeric team profile (owner-approved k = 3). Thin delegate: the only inputs are the path `teamId` and the bearer
 * token. The query string, body and other headers are never read, so no threshold, level or filter can be requested. Every
 * decision lives in the operation; the response is built by the strict DTO allow-list. Only GET is exported.
 */
export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const match = BEARER_PATTERN.exec(request.headers.get("authorization") ?? "");
  const result = await getTeamSkillLevels(match ? match[1] : "", teamId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS[result.error] ?? 500, headers: NO_STORE });
  }

  return NextResponse.json(toTeamSkillLevelsDto(result), { status: 200, headers: NO_STORE });
}

import { NextResponse } from "next/server";
import { getTeamSkillCoverage } from "../../../../../src/features/team-skills/server/get-team-skill-coverage";

const BEARER_PATTERN = /^Bearer (.+)$/;
const NO_STORE = { "Cache-Control": "no-store" };

const STATUS: Record<string, number> = {
  unauthenticated: 401,
  forbidden: 403,
  team_disabled: 409,
  read_failed: 500,
};

/**
 * Privacy-thresholded team skill coverage (SPEC — BR-16). Thin delegate: the only
 * inputs are the path `teamId` and the bearer token. The query string, body and
 * other headers are never read, so no query-time threshold or level can exist.
 * Authorization, the k-threshold and all derivation live in the operation. Only
 * GET is exported.
 */
export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const match = BEARER_PATTERN.exec(request.headers.get("authorization") ?? "");
  const result = await getTeamSkillCoverage(match ? match[1] : "", teamId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS[result.error] ?? 500, headers: NO_STORE });
  }

  // Field-by-field allow-list; an "incomplete" scan carries no rows.
  return NextResponse.json(
    {
      availability: result.availability,
      rows: result.rows.map((row) => ({
        treeId: row.treeId,
        areaName: row.areaName,
        requiredLevel: row.requiredLevel,
        requiredCoverage: row.requiredCoverage,
        state: row.state,
      })),
    },
    { status: 200, headers: NO_STORE },
  );
}

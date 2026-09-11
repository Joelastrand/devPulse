import { NextResponse } from "next/server";
import { getTeamResults } from "../../../../../src/features/results/server/get-team-results";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Protected, per-team dashboard/trend endpoint — the team-management
 * successor to `/api/results` (docs/features/team-management/SPEC.md).
 * `teamId` comes from the URL path but is never trusted as authorization
 * evidence on its own: `getTeamResults` always re-derives access via
 * `authorizeTeamAccess` before any protected data is read (item 9). Kept
 * thin; orchestration lives in `getTeamResults`. Does not modify or
 * replace `/api/results` — the two coexist until the old static-mapping
 * path is retired (SPEC → Migration strategy).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await getTeamResults(token, teamId);

  if (!result.ok) {
    const status =
      result.error === "unauthenticated"
        ? 401
        : result.error === "forbidden"
          ? 403
          : 500;
    return NextResponse.json({ status: result.error }, { status });
  }

  return NextResponse.json(
    {
      status: "ok",
      teamId: result.teamId,
      current: result.current,
      trend: result.trend,
    },
    { status: 200 },
  );
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

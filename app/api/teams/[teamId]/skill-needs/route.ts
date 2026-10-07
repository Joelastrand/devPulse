import { NextResponse } from "next/server";
import { listSkillNeeds } from "../../../../../src/features/team-skills/server/list-skill-needs";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Team skill needs read (docs/features/team-skill-needs-and-matrix/SPEC.md — BR-4).
 * Thin delegate to `listSkillNeeds`; `teamId` comes from the URL path only and
 * all authorization decisions live in the delegated operation. Read-only: no
 * other method is exported.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await listSkillNeeds(token, teamId);

  if (!result.ok) {
    const status =
      result.error === "unauthenticated" ? 401 : result.error === "forbidden" ? 403 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(
    {
      needs: result.needs.map((need) => ({
        treeId: need.treeId,
        areaName: need.areaName,
        areaAvailable: need.areaAvailable,
        requiredLevel: need.requiredLevel,
        requiredCoverage: need.requiredCoverage,
      })),
      catalog: result.catalog.map((entry) => ({ treeId: entry.treeId, name: entry.name })),
      catalogTruncated: result.catalogTruncated,
      needsTruncated: result.needsTruncated,
      viewer: {
        canManageNeeds: result.viewer.canManageNeeds,
        canReadCoverage: result.viewer.canReadCoverage,
      },
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

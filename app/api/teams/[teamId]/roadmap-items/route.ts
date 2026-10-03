import { NextResponse } from "next/server";
import { createRoadmapItem } from "../../../../../src/features/roadmap/server/create-roadmap-item";
import { listRoadmapItems } from "../../../../../src/features/roadmap/server/list-roadmap-items";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Roadmap read (docs/features/team-skill-planning/SPEC.md — BR-8). Thin
 * delegate to `listRoadmapItems`; `teamId` comes from the URL path only and
 * all authorization/read decisions live in the delegated operation. Read-only.
 * `?archived=true` includes archived plans; any other value does not.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const includeArchived = new URL(request.url).searchParams.get("archived") === "true";
  const result = await listRoadmapItems(token, teamId, { includeArchived });

  if (!result.ok) {
    const status =
      result.error === "unauthenticated" ? 401 : result.error === "forbidden" ? 403 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(
    { items: result.items, canEdit: result.canEdit, truncated: result.truncated },
    { status: 200 },
  );
}

const POST_STATUS: Record<string, number> = {
  unauthenticated: 401,
  forbidden: 403,
  invalid_request: 400,
  invalid_input: 400,
  target_not_ahead: 400,
  invalid_owner: 400,
  team_disabled: 400,
  not_tracked: 404,
  tree_not_found: 404,
  already_planned: 409,
  plan_archived: 409,
  persistence_failed: 500,
};

/**
 * Plan creation (SPEC — BR-13). Thin delegate to `createRoadmapItem`; `teamId`
 * comes from the URL path only. Unparsable JSON is `invalid_request`. No
 * DELETE (or other) method is exported.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }

  const result = await createRoadmapItem(token, teamId, body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: POST_STATUS[result.error] ?? 500 });
  }
  return NextResponse.json({ item: result.item }, { status: 201 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

import { NextResponse } from "next/server";
import { updateRoadmapItem } from "../../../../../../src/features/roadmap/server/update-roadmap-item";

const BEARER_PATTERN = /^Bearer (.+)$/;

const PATCH_STATUS: Record<string, number> = {
  unauthenticated: 401,
  forbidden: 403,
  invalid_request: 400,
  invalid_input: 400,
  target_not_ahead: 400,
  invalid_owner: 400,
  team_disabled: 400,
  not_tracked: 404,
  tree_not_found: 404,
  not_found: 404,
  archived: 409,
  persistence_failed: 500,
};

/**
 * Plan update / status / archive / restore (SPEC — BR-14). Thin delegate to
 * `updateRoadmapItem`; `teamId`/`treeId` come from the URL path only.
 * Unparsable JSON is `invalid_request`. No DELETE (or other) method is exported.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ teamId: string; treeId: string }> },
) {
  const { teamId, treeId } = await params;
  const match = BEARER_PATTERN.exec(request.headers.get("authorization") ?? "");
  const token = match ? match[1] : "";

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }

  const result = await updateRoadmapItem(token, teamId, treeId, body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: PATCH_STATUS[result.error] ?? 500 });
  }
  return NextResponse.json({ item: result.item }, { status: 200 });
}

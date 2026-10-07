import { NextResponse } from "next/server";
import { deleteSkillNeed } from "../../../../../../src/features/team-skills/server/delete-skill-need";
import { upsertSkillNeed } from "../../../../../../src/features/team-skills/server/upsert-skill-need";

const BEARER_PATTERN = /^Bearer (.+)$/;

const STATUS: Record<string, number> = {
  unauthenticated: 401,
  forbidden: 403,
  invalid_request: 400,
  invalid_input: 400,
  skill_unavailable: 404,
  team_disabled: 409,
  persistence_failed: 500,
};

type RouteContext = { params: Promise<{ teamId: string; treeId: string }> };

function bearerToken(request: Request): string {
  const match = BEARER_PATTERN.exec(request.headers.get("authorization") ?? "");
  return match ? match[1] : "";
}

/**
 * Lead-only need create/replace (SPEC — BR-5). Thin delegate; `teamId`/`treeId`
 * come from the URL path only and the caller's role is decided server-side by the
 * operation. Unparsable JSON is passed on as `undefined` so it is judged only
 * after authorization. Only `PUT` and `DELETE` are exported.
 */
export async function PUT(request: Request, { params }: RouteContext) {
  const { teamId, treeId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }

  const result = await upsertSkillNeed(bearerToken(request), teamId, treeId, body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS[result.error] ?? 500 });
  }
  return NextResponse.json(
    {
      need: {
        treeId: result.need.treeId,
        areaName: result.need.areaName,
        areaAvailable: result.need.areaAvailable,
        requiredLevel: result.need.requiredLevel,
        requiredCoverage: result.need.requiredCoverage,
      },
    },
    { status: 200 },
  );
}

/** Lead-only idempotent hard delete (SPEC — BR-5). No body is read. */
export async function DELETE(request: Request, { params }: RouteContext) {
  const { teamId, treeId } = await params;
  const result = await deleteSkillNeed(bearerToken(request), teamId, treeId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS[result.error] ?? 500 });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}

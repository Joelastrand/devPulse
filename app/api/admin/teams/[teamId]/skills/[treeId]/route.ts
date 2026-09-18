import { NextResponse } from "next/server";
import { updateTeamSkillProgress } from "../../../../../../../src/features/skill-trees/server/update-team-skill-progress";
import { stopTeamSkillTracking } from "../../../../../../../src/features/skill-trees/server/stop-team-skill-tracking";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only "set current stage" / "stop tracking" endpoints (docs/features/
 * team-skill-tree/SPEC.md — TASK-006, BR-27). Kept thin — `teamId`/`treeId`
 * come only from the route params (route-authoritative, never body-supplied);
 * `PATCH`'s body is read for exactly `{nodeId}`. Neither handler adds a
 * team-status gate of its own — `updateTeamSkillProgress`/
 * `stopTeamSkillTracking` are the sole, already-authorized authority on
 * whether a disabled team's existing tracking may be managed (SPEC — Owner
 * decision 5; `.claude/rules/nextjs-react.md`, `.claude/rules/security.md`).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ teamId: string; treeId: string }> },
) {
  const { teamId, treeId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const result = await updateTeamSkillProgress(token, teamId, treeId, record.nodeId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForUpdateError(result.error) });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ teamId: string; treeId: string }> },
) {
  const { teamId, treeId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await stopTeamSkillTracking(token, teamId, treeId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForStopError(result.error) });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

function statusForUpdateError(
  error: "unauthenticated" | "forbidden" | "not_tracked" | "tree_not_found" | "invalid_input" | "persistence_failed",
): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  if (error === "not_tracked" || error === "tree_not_found") return 404;
  if (error === "invalid_input") return 400;
  return 500;
}

function statusForStopError(error: "unauthenticated" | "forbidden" | "persistence_failed"): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  return 500;
}

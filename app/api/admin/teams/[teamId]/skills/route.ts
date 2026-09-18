import { NextResponse } from "next/server";
import { startTeamSkillTracking } from "../../../../../../src/features/skill-trees/server/start-team-skill-tracking";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only "start tracking" endpoint (docs/features/team-skill-tree/
 * SPEC.md — TASK-006, BR-27). Kept thin — `teamId` comes only from the route
 * param (route-authoritative, never body-supplied); the request body is read
 * for exactly `{treeId}` and nothing else ever reaches `startTeamSkillTracking`
 * — no `currentNodeId`, `updatedAt`/`updatedBy`, or alternate-`teamId` field
 * has any path from this route into the operation
 * (`.claude/rules/nextjs-react.md`, `.claude/rules/security.md`).
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
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const treeId = typeof record.treeId === "string" ? record.treeId : "";
  const result = await startTeamSkillTracking(token, teamId, treeId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForError(result.error) });
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

function statusForError(
  error: "unauthenticated" | "forbidden" | "tree_not_found" | "team_not_found" | "team_disabled" | "persistence_failed",
): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  if (error === "tree_not_found" || error === "team_not_found") return 404;
  if (error === "team_disabled") return 400;
  return 500;
}

import { NextResponse } from "next/server";
import { reportTeamSkillProgress } from "../../../../../../src/features/skill-trees/server/report-team-skill-progress";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * `/teams/[teamId]`'s member-facing self-report endpoint (docs/features/
 * skill-progress-self-report/SPEC.md — TASK-002, BR-14). `PATCH` is a thin
 * delegate to `reportTeamSkillProgress` (TASK-001) — `teamId`/`treeId` come
 * only from the route params (route-authoritative, never body-supplied) and
 * the body is accepted only as exactly `{nodeId}`: malformed JSON, a
 * non-object body, a missing `nodeId` key, or any extra/unapproved key is
 * rejected before the operation is ever called. Every authorization/
 * team-status/tracking decision lives in the delegated server operation,
 * never here (`.claude/rules/nextjs-react.md`, `.claude/rules/security.md`)
 * — this route adds no authorization logic of its own, mirroring the
 * existing admin `PATCH` route's identical thin-delegate posture. No other
 * HTTP method is exported — a member can never start/stop tracking via this
 * route (SPEC "Out of scope").
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
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "nodeId") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await reportTeamSkillProgress(token, teamId, treeId, record.nodeId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForReportError(result.error) });
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

function statusForReportError(
  error:
    | "unauthenticated"
    | "forbidden"
    | "team_disabled"
    | "not_tracked"
    | "tree_not_found"
    | "invalid_input"
    | "persistence_failed",
): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  if (error === "team_disabled") return 400;
  if (error === "not_tracked" || error === "tree_not_found") return 404;
  if (error === "invalid_input") return 400;
  return 500;
}

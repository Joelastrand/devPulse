import { NextResponse } from "next/server";
import { updateSkillTree } from "../../../../../src/features/skill-trees/server/update-skill-tree";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only SkillTree cosmetic-correction endpoint (docs/features/
 * team-skill-tree/SPEC.md — "Cosmetic tree correction", BR-31, BR-32). Kept
 * thin — `treeId` comes only from the route param (route-authoritative,
 * never body-supplied); the request body is read for exactly `{name,
 * nodeLabels}` and nothing else ever reaches `updateSkillTree` — no
 * `nodeId`, structural `nodes` array, or audit/timestamp field has any path
 * from this route into the operation.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ treeId: string }> },
) {
  const { treeId } = await params;
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
  const result = await updateSkillTree(token, treeId, record.name, record.nodeLabels);

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
  error:
    | "unauthenticated"
    | "forbidden"
    | "tree_not_found"
    | "invalid_input"
    | "node_count_mismatch"
    | "persistence_failed",
): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  if (error === "tree_not_found") return 404;
  if (error === "invalid_input" || error === "node_count_mismatch") return 400;
  return 500;
}

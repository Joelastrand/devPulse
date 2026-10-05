import { NextResponse } from "next/server";
import { clearOwnSkillLevel } from "../../../../../src/features/skill-profiles/server/clear-own-skill-level";
import { setOwnSkillLevel } from "../../../../../src/features/skill-profiles/server/set-own-skill-level";

const BEARER_PATTERN = /^Bearer (.+)$/;

type RouteContext = { params: Promise<{ treeId: string }> };

/**
 * Own single-skill self-assessment writes (docs/features/individual-skill-self-
 * assessment/SPEC.md — BR-12, BR-13). Thin: the only subject is the verified
 * token; `treeId` from the path is the only resource identifier. `PUT` and
 * `DELETE` only.
 */
export async function PUT(request: Request, { params }: RouteContext) {
  const { treeId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }

  const result = await setOwnSkillLevel(token, treeId, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: statusForError(result.error) });
  return NextResponse.json({ level: result.level }, { status: 200 });
}

/** The request body is deliberately never read. */
export async function DELETE(request: Request, { params }: RouteContext) {
  const { treeId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));

  const result = await clearOwnSkillLevel(token, treeId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: statusForError(result.error) });
  return NextResponse.json({ level: null }, { status: 200 });
}

function extractBearerToken(header: string | null): string {
  if (!header) return "";
  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

function statusForError(
  error:
    | "unauthenticated"
    | "invalid_request"
    | "invalid_input"
    | "skill_unavailable"
    | "profile_unreadable"
    | "persistence_failed",
): number {
  if (error === "unauthenticated") return 401;
  if (error === "invalid_request" || error === "invalid_input") return 400;
  if (error === "skill_unavailable") return 404;
  if (error === "profile_unreadable") return 409;
  return 500;
}

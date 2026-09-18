import { NextResponse } from "next/server";
import { deleteReply } from "../../../../../../../../../src/features/forum/server/delete-reply";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Tombstones one reply (docs/features/team-forum/SPEC.md — TASK-005,
 * "API/DTO contract"). Thin delegate — `deleteReply` owns every
 * authorization/idempotency decision, including BR-27's unconditional
 * idempotent success for a retry against an already-tombstoned,
 * correctly-scoped reply.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ teamId: string; threadId: string; replyId: string }> },
) {
  const { teamId, threadId, replyId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await deleteReply(token, teamId, threadId, replyId);

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

function statusForError(error: "sign_in_required" | "forbidden" | "not_found" | "persistence_failed"): number {
  if (error === "sign_in_required") return 401;
  if (error === "not_found") return 404;
  if (error === "forbidden") return 403;
  return 500;
}

import { NextResponse } from "next/server";
import { deleteThread } from "../../../../../../../src/features/forum/server/delete-thread";
import { getThreadWithReplies } from "../../../../../../../src/features/forum/server/get-thread-with-replies";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * `/teams/[teamId]/forum/[threadId]`'s read/delete endpoints (docs/
 * features/team-forum/SPEC.md — TASK-005, "API/DTO contract"). A cross-team,
 * deleted, or never-existed `threadId` resolves to the identical `not_found`
 * for both handlers — never a distinguishing message (BR-16, BR-32). Thin
 * delegates only — `getThreadWithReplies`/`deleteThread` own every
 * authorization/lifecycle decision.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string; threadId: string }> },
) {
  const { teamId, threadId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await getThreadWithReplies(token, teamId, threadId);

  if (!result.ok) {
    const status = statusForReadError(result.error);
    return NextResponse.json({ status: result.error }, { status });
  }

  return NextResponse.json({ status: "ok", thread: result.thread, replies: result.replies }, { status: 200 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ teamId: string; threadId: string }> },
) {
  const { teamId, threadId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await deleteThread(token, teamId, threadId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForDeleteError(result.error) });
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

function statusForReadError(error: "unauthenticated" | "forbidden" | "not_found" | "read_failed"): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  if (error === "not_found") return 404;
  return 500;
}

function statusForDeleteError(error: "sign_in_required" | "forbidden" | "not_found" | "persistence_failed"): number {
  if (error === "sign_in_required") return 401;
  if (error === "not_found") return 404;
  if (error === "forbidden") return 403;
  return 500;
}

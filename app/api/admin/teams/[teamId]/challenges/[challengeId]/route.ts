import { NextResponse } from "next/server";
import { deleteChallenge } from "../../../../../../../src/features/challenges/server/delete-challenge";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only challenge-delete endpoint (docs/features/
 * anonymous-challenges/SPEC.md — TASK-006, BR-16, BR-20). `DELETE`
 * permanently removes the target challenge, regardless of its current
 * status — no response-count-style precondition, unlike survey removal
 * (BR-20). Kept thin — authorization and every rejection reason live in
 * `deleteChallenge` (`.claude/rules/nextjs-react.md`); this route
 * duplicates none of that decision logic. `teamId`/`challengeId` come from
 * the URL path but are never trusted as authorization evidence on their
 * own.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ teamId: string; challengeId: string }> },
) {
  const { teamId, challengeId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await deleteChallenge(token, teamId, challengeId);

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
  error: "unauthenticated" | "forbidden" | "not_found" | "wrong_team" | "persistence_failed",
): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  if (error === "not_found" || error === "wrong_team") return 404;
  return 500;
}

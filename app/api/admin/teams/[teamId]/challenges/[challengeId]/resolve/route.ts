import { NextResponse } from "next/server";
import { resolveChallenge } from "../../../../../../../../src/features/challenges/server/resolve-challenge";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only challenge-resolve endpoint (docs/features/
 * anonymous-challenges/SPEC.md — TASK-006, BR-16, BR-17). Kept thin —
 * authorization, idempotency, and every rejection reason live in
 * `resolveChallenge` (`.claude/rules/nextjs-react.md`); this route
 * duplicates none of that decision logic. `teamId`/`challengeId` come from
 * the URL path but are never trusted as authorization evidence on their
 * own. No lifecycle/audit field (`resolvedBy`, `resolvedAt`) is ever read
 * from the request body — the server operation owns both.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ teamId: string; challengeId: string }> },
) {
  const { teamId, challengeId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await resolveChallenge(token, teamId, challengeId);

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
  error: "unauthenticated" | "forbidden" | "not_found" | "wrong_team" | "not_open" | "persistence_failed",
): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  if (error === "not_found" || error === "wrong_team") return 404;
  if (error === "not_open") return 409;
  return 500;
}

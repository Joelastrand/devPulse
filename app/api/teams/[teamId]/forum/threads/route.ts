import { NextResponse } from "next/server";
import { createThread } from "../../../../../../src/features/forum/server/create-thread";
import { listTeamThreads } from "../../../../../../src/features/forum/server/list-team-threads";

const BEARER_PATTERN = /^Bearer (.+)$/;

const CREATE_ERROR_STATUS: Record<string, number> = {
  sign_in_required: 401,
  invalid_input: 400,
  forbidden: 403,
  team_not_found: 404,
  team_disabled: 400,
  encryption_failed: 500,
  persistence_failed: 500,
};

/**
 * `/teams/[teamId]`'s forum thread-list/create endpoints (docs/features/
 * team-forum/SPEC.md — TASK-005, "API/DTO contract"). Both handlers are thin
 * delegates: every authorization/validation/lifecycle decision lives in
 * `listTeamThreads`/`createThread` (`.claude/rules/nextjs-react.md`,
 * `.claude/rules/security.md`) — `teamId` comes from the URL path but is
 * never trusted as authorization evidence on its own.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await listTeamThreads(token, teamId);

  if (!result.ok) {
    const status = result.error === "unauthenticated" ? 401 : result.error === "forbidden" ? 403 : 500;
    return NextResponse.json({ status: result.error }, { status });
  }

  return NextResponse.json({ status: "ok", threads: result.threads }, { status: 200 });
}

/**
 * Creates a new thread for `teamId`. Accepts only `title`/`body` from the
 * request body — no `teamId` override, no author identity, no lifecycle
 * field of any kind (BR-2, BR-47); `createThread` derives everything else
 * server-side. Returns the generated `threadId` only — never echoes the
 * submitted title/body.
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
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const result = await createThread(token, teamId, record.title, record.body);

  if (!result.ok) {
    const status = CREATE_ERROR_STATUS[result.error] ?? 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true, threadId: result.threadId }, { status: 201 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

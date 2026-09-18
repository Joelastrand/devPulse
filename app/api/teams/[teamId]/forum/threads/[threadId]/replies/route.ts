import { NextResponse } from "next/server";
import { createReply } from "../../../../../../../../src/features/forum/server/create-reply";

const BEARER_PATTERN = /^Bearer (.+)$/;

const CREATE_ERROR_STATUS: Record<string, number> = {
  sign_in_required: 401,
  invalid_input: 400,
  forbidden: 403,
  not_found: 404,
  team_disabled: 400,
  thread_full: 400,
  encryption_failed: 500,
  persistence_failed: 500,
};

/**
 * Creates a reply to `threadId` (docs/features/team-forum/SPEC.md —
 * TASK-005, "API/DTO contract"). Accepts only `body` from the request body —
 * no `teamId`/`threadId` override, no author identity, no lifecycle field of
 * any kind (BR-2, BR-47); `createReply` derives everything else
 * server-side. `thread_full` maps to 400 (BR-52). Never echoes the
 * submitted body.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ teamId: string; threadId: string }> },
) {
  const { teamId, threadId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const result = await createReply(token, teamId, threadId, record.body);

  if (!result.ok) {
    const status = CREATE_ERROR_STATUS[result.error] ?? 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

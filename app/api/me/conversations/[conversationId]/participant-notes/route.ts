import { NextResponse } from "next/server";
import { CONVERSATION_ERROR_STATUS, type ConversationErrorCode } from "../../../../../../src/features/development-conversations/domain/errors";
import { writeParticipantNotes } from "../../../../../../src/features/development-conversations/server/write-participant-notes";
import { verifiedSubject } from "../../_auth";
import { readConversationBody } from "../../_body";

const NO_STORE = { "Cache-Control": "no-store" };
const NOTES_KEYS: ReadonlySet<string> = new Set(["notes"]);

type RouteContext = { params: Promise<{ conversationId: string }> };

/**
 * Accepted participant writes `participantNotes` only (SPEC BR-20, BR-48, BR-49; TASK-024). The body is exactly
 * `{ notes }`. Access, completion and the key are all decided inside the operation, so this route makes no decision.
 */
export async function PUT(request: Request, { params }: RouteContext) {
  const subject = await verifiedSubject(request);
  if (!subject) return fail("unauthenticated", 401);

  const body = await readConversationBody(request, NOTES_KEYS);
  if (!body.ok) return fail(body.error, CONVERSATION_ERROR_STATUS[body.error]);

  const { conversationId } = await params;
  const result = await writeParticipantNotes(subject, conversationId, body.body.notes);
  return result.ok ? json({ ok: true }, 200) : fail(result.error, CONVERSATION_ERROR_STATUS[result.error]);
}

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: NO_STORE });
const fail = (error: ConversationErrorCode, status: number) => json({ error }, status);

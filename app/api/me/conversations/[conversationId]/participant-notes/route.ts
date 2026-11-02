import { NextResponse } from "next/server";
import { conversationResponseStatus, type ConversationResponseCode } from "../../../../../../src/features/development-conversations/domain/errors";
import { writeParticipantNotes } from "../../../../../../src/features/development-conversations/server/write-participant-notes";
import { verifiedSubject } from "../../_auth";
import { readConversationBody } from "../../_body";
import { authRefusalStatus } from "../../../../../../src/features/auth/server/auth-refusal";

const NO_STORE = { "Cache-Control": "no-store" };
const NOTES_KEYS: ReadonlySet<string> = new Set(["notes"]);

type RouteContext = { params: Promise<{ conversationId: string }> };

/**
 * Accepted participant writes `participantNotes` only (SPEC BR-20, BR-48, BR-49; TASK-024). The body is exactly
 * `{ notes }`. Access, completion and the key are all decided inside the operation, so this route makes no decision.
 */
export async function PUT(request: Request, { params }: RouteContext) {
  const verified = await verifiedSubject(request);
  if (!verified.ok) return json({ error: verified.error }, authRefusalStatus(verified.error));
  const subject = verified.uid;

  const body = await readConversationBody(request, NOTES_KEYS);
  if (!body.ok) return fail(body.error, conversationResponseStatus(body.error));

  const { conversationId } = await params;
  const result = await writeParticipantNotes(subject, conversationId, body.body.notes);
  return result.ok ? json({ ok: true }, 200) : fail(result.error, conversationResponseStatus(result.error));
}

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: NO_STORE });
const fail = (error: ConversationResponseCode, status: number) => json({ error }, status);

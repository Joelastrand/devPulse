import { NextResponse } from "next/server";
import { CONVERSATION_ERROR_STATUS, type ConversationErrorCode } from "../../../../../../src/features/development-conversations/domain/errors";
import { leaveParticipation } from "../../../../../../src/features/development-conversations/server/respond-to-participation";
import { verifiedSubject } from "../../_auth";
import { readEmptyConversationBody } from "../../_body";

const NO_STORE = { "Cache-Control": "no-store" };

type RouteContext = { params: Promise<{ conversationId: string }> };

/**
 * Ends the caller's own participation (SPEC BR-17; TASK-024). One route for both a pending decline and an accepted leave,
 * because the operation chooses the branch from the stored state. Success is `204` with no body. Takes no body.
 */
export async function DELETE(request: Request, { params }: RouteContext) {
  const subject = await verifiedSubject(request);
  if (!subject) return fail("unauthenticated", 401);

  const body = await readEmptyConversationBody(request);
  if (!body.ok) return fail(body.error, CONVERSATION_ERROR_STATUS[body.error]);

  const { conversationId } = await params;
  const result = await leaveParticipation(subject, conversationId);
  return result.ok ? new NextResponse(null, { status: 204, headers: NO_STORE }) : fail(result.error, CONVERSATION_ERROR_STATUS[result.error]);
}

const fail = (error: ConversationErrorCode, status: number) => NextResponse.json({ error }, { status, headers: NO_STORE });

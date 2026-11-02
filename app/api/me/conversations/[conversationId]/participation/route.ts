import { NextResponse } from "next/server";
import { conversationResponseStatus, type ConversationResponseCode } from "../../../../../../src/features/development-conversations/domain/errors";
import { leaveParticipation } from "../../../../../../src/features/development-conversations/server/respond-to-participation";
import { verifiedSubject } from "../../_auth";
import { readEmptyConversationBody } from "../../_body";
import { type AuthRefusal, authRefusalStatus } from "../../../../../../src/features/auth/server/auth-refusal";

const NO_STORE = { "Cache-Control": "no-store" };

type RouteContext = { params: Promise<{ conversationId: string }> };

/**
 * Ends the caller's own participation (SPEC BR-17; TASK-024). One route for both a pending decline and an accepted leave,
 * because the operation chooses the branch from the stored state. Success is `204` with no body. Takes no body.
 */
export async function DELETE(request: Request, { params }: RouteContext) {
  const verified = await verifiedSubject(request);
  if (!verified.ok) return fail(verified.error, authRefusalStatus(verified.error));
  const subject = verified.uid;

  const body = await readEmptyConversationBody(request);
  if (!body.ok) return fail(body.error, conversationResponseStatus(body.error));

  const { conversationId } = await params;
  const result = await leaveParticipation(subject, conversationId);
  return result.ok ? new NextResponse(null, { status: 204, headers: NO_STORE }) : fail(result.error, conversationResponseStatus(result.error));
}

const fail = (error: ConversationResponseCode | AuthRefusal, status: number) => NextResponse.json({ error }, { status, headers: NO_STORE });

import { NextResponse } from "next/server";
import { CONVERSATION_ERROR_STATUS, type ConversationErrorCode } from "../../../../../../../src/features/development-conversations/domain/errors";
import { acceptInvitation } from "../../../../../../../src/features/development-conversations/server/respond-to-participation";
import { verifiedSubject } from "../../../_auth";
import { readEmptyConversationBody } from "../../../_body";

const NO_STORE = { "Cache-Control": "no-store" };

type RouteContext = { params: Promise<{ conversationId: string }> };

/**
 * Accepts a pending invitation (SPEC BR-15; TASK-024). Takes no body. The response carries the accepted state only, and
 * no conversation content (D2-SI-3). The re-check of BR-15, BR-9 and BR-21 happens inside the operation's transaction.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const subject = await verifiedSubject(request);
  if (!subject) return fail("unauthenticated", 401);

  const body = await readEmptyConversationBody(request);
  if (!body.ok) return fail(body.error, CONVERSATION_ERROR_STATUS[body.error]);

  const { conversationId } = await params;
  const result = await acceptInvitation(subject, conversationId);
  return result.ok ? json({ state: "accepted" }, 200) : fail(result.error, CONVERSATION_ERROR_STATUS[result.error]);
}

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: NO_STORE });
const fail = (error: ConversationErrorCode, status: number) => json({ error }, status);

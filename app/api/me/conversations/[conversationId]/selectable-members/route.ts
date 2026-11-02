import { NextResponse } from "next/server";
import { conversationResponseStatus, type ConversationResponseCode } from "../../../../../../src/features/development-conversations/domain/errors";
import { productionSelectableMembersDeps } from "../../../../../../src/features/development-conversations/server/owner-route-deps";
import { readSelectableMembers } from "../../../../../../src/features/development-conversations/server/read-selectable-members";
import { verifiedSubject } from "../../_auth";
import { authRefusalStatus } from "../../../../../../src/features/auth/server/auth-refusal";

const NO_STORE = { "Cache-Control": "no-store" };

type RouteContext = { params: Promise<{ conversationId: string }> };

/**
 * The owner's selectable teammates for one conversation (SPEC Amendment 2026-10-19, TASK-029 I-1). Thin: the subject is the
 * uid of the verified bearer token and the path supplies a conversation id only. The operation applies the owner predicate,
 * and this route serialises exactly the DTO keys. Nothing here decides access, and the response grants no authority.
 */
export async function GET(request: Request, { params }: RouteContext) {
  const verified = await verifiedSubject(request);
  if (!verified.ok) return json({ error: verified.error }, authRefusalStatus(verified.error));
  const subject = verified.uid;

  const { conversationId } = await params;
  const result = await readSelectableMembers(subject, conversationId, productionSelectableMembersDeps());
  if (!result.ok) return fail(result.error);

  return json(
    {
      members: result.members.map((member) => ({
        memberRef: member.memberRef,
        displayName: member.displayName,
        ordinal: member.ordinal,
        isSelf: member.isSelf,
      })),
      unavailableCount: result.unavailableCount,
      truncated: result.truncated,
    },
    200,
  );
}

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: NO_STORE });
const fail = (error: ConversationResponseCode) => json({ error }, conversationResponseStatus(error));

import { NextResponse } from "next/server";
import { conversationResponseStatus, type ConversationResponseCode } from "../../../../../src/features/development-conversations/domain/errors";
import { readCreateOptions } from "../../../../../src/features/development-conversations/server/read-create-options";
import { verifiedSubject } from "../_auth";
import { authRefusalStatus } from "../../../../../src/features/auth/server/auth-refusal";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Teams the caller may choose for a new conversation (SPEC create-options contract, TASK-027 amendment). Thin: the subject
 * is the uid of the verified bearer token. The route calls one operation, serialises exactly `{ teamId, name }` per item,
 * and maps the stable code. It makes no eligibility decision and reads no request input.
 */
export async function GET(request: Request) {
  const verified = await verifiedSubject(request);
  if (!verified.ok) return json({ error: verified.error }, authRefusalStatus(verified.error));
  const subject = verified.uid;

  const result = await readCreateOptions(subject);
  if (!result.ok) return fail(result.error);

  return json(
    {
      items: result.items.map((item) => ({ teamId: item.teamId, name: item.name })),
      truncated: result.truncated,
    },
    200,
  );
}

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: NO_STORE });
const fail = (error: ConversationResponseCode) => json({ error }, conversationResponseStatus(error));

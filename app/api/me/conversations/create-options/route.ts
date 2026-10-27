import { NextResponse } from "next/server";
import { CONVERSATION_ERROR_STATUS, type ConversationErrorCode } from "../../../../../src/features/development-conversations/domain/errors";
import { readCreateOptions } from "../../../../../src/features/development-conversations/server/read-create-options";
import { verifiedSubject } from "../_auth";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Teams the caller may choose for a new conversation (SPEC create-options contract, TASK-027 amendment). Thin: the subject
 * is the uid of the verified bearer token. The route calls one operation, serialises exactly `{ teamId, name }` per item,
 * and maps the stable code. It makes no eligibility decision and reads no request input.
 */
export async function GET(request: Request) {
  const subject = await verifiedSubject(request);
  if (!subject) return fail("unauthenticated");

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
const fail = (error: ConversationErrorCode) => json({ error }, CONVERSATION_ERROR_STATUS[error]);

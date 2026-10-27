import { NextResponse } from "next/server";
import { CONVERSATION_ERROR_STATUS, type ConversationErrorCode } from "../../../../src/features/development-conversations/domain/errors";
import {
  OWNER_PARTICIPANT_KEYS,
  OWNER_SUMMARY_KEYS,
  PARTICIPANT_SUMMARY_KEYS,
  RECOVERY_ITEM_KEYS,
} from "../../../../src/features/development-conversations/domain/dto-keys";
import { createConversation } from "../../../../src/features/development-conversations/server/create-conversation";
import { productionOwnerReadDeps } from "../../../../src/features/development-conversations/server/owner-route-deps";
import {
  readOwnerConversations,
  type OwnerConversationSummary,
} from "../../../../src/features/development-conversations/server/read-owner-conversations";
import { readParticipations } from "../../../../src/features/development-conversations/server/read-participations";
import { verifiedSubject } from "./_auth";
import { readConversationBody } from "./_body";

const NO_STORE = { "Cache-Control": "no-store" };

/** BR-2: the only keys a create body may carry. Owner, uid and participant selectors are refused as unknown. */
const CREATE_KEYS: ReadonlySet<string> = new Set(["title", "plannedFor", "teamId"]);

/**
 * Owner list and create (SPEC BR-1, BR-2, BR-33, BR-34, BR-40, BR-44; TASK-023). Thin: the only subject is the uid of the
 * verified bearer token. The route reads the body, calls one operation, maps its stable code to the SPEC status and
 * serialises an approved DTO. It makes no authorization decision.
 */
export async function GET(request: Request) {
  const subject = await verifiedSubject(request);
  if (!subject) return fail("unauthenticated", 401);

  const owned = await readOwnerConversations(subject, productionOwnerReadDeps());
  if (!owned.ok) return fail(owned.error, CONVERSATION_ERROR_STATUS[owned.error]);

  const participating = await readParticipations(subject);
  if (!participating.ok) return fail(participating.error, CONVERSATION_ERROR_STATUS[participating.error]);

  // BR-33: summaries first in the operation's order, then recovery items. No re-sort, no interleaving, no added metadata.
  return json(
    {
      owned: {
        items: [...owned.conversations.map(pickOwnerSummary), ...owned.recovery.map((item) => pick(item, RECOVERY_ITEM_KEYS))],
        truncated: owned.truncated,
      },
      participating: {
        items: participating.participations.map((entry) => pick(entry, PARTICIPANT_SUMMARY_KEYS)),
        truncated: participating.truncated,
      },
    },
    200,
  );
}

export async function POST(request: Request) {
  const subject = await verifiedSubject(request);
  if (!subject) return fail("unauthenticated", 401);

  const body = await readConversationBody(request, CREATE_KEYS);
  if (!body.ok) return fail(body.error, CONVERSATION_ERROR_STATUS[body.error]);

  const result = await createConversation(subject, {
    title: body.body.title,
    plannedFor: body.body.plannedFor,
    teamId: body.body.teamId,
  });
  if (!result.ok) return fail(result.error, CONVERSATION_ERROR_STATUS[result.error]);
  return json({ conversationId: result.conversationId }, 201);
}

/** The BR-44 owner summary, built field by field from the allow-lists. The nested participant is allow-listed too. */
function pickOwnerSummary(summary: OwnerConversationSummary): Record<string, unknown> {
  return { ...pick(summary, OWNER_SUMMARY_KEYS), participant: pick(summary.participant, OWNER_PARTICIPANT_KEYS) };
}

/** Copies exactly `keys` from `source`. Nothing else is ever spread into a response. */
function pick(source: object, keys: readonly string[]): Record<string, unknown> {
  const record = source as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, record[key]]));
}

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: NO_STORE });
const fail = (error: ConversationErrorCode, status: number) => json({ error }, status);

import "server-only";
import { isConversationId } from "../domain/conversation-id";
import { getDefaultConversationStore } from "./conversation-store";
import { assertUidSegment, type ConversationStore, type RawConversationData } from "./conversation-store-types";

/**
 * Owner hard delete (SPEC BR-5, BR-29, IMPL-1; TASK-010). One transaction removes the owner document and, when its
 * `participantUid` is readable, the participant index at that path. Delete reads plain fields only and never decrypts,
 * so a malformed or unreadable payload can still be deleted (BR-29). No tombstone is written.
 */

export interface DeleteConversationDeps {
  store: ConversationStore;
}

export type DeleteConversationResult = { ok: true } | { ok: false; error: "conversation_not_found" | "persistence_failed" };

/** The participant uid when it is a readable uid segment, otherwise `null`. An unreadable uid leaves the index alone. */
function readableParticipantUid(raw: RawConversationData): string | null {
  const uid = raw.participantUid;
  try {
    assertUidSegment(uid);
    return uid;
  } catch {
    return null;
  }
}

export async function deleteConversation(
  ownerUid: string,
  conversationId: string,
  deps: DeleteConversationDeps = { store: getDefaultConversationStore() },
): Promise<DeleteConversationResult> {
  if (!isConversationId(conversationId)) return { ok: false, error: "conversation_not_found" };

  try {
    return await deps.store.runTransaction(async (tx): Promise<DeleteConversationResult> => {
      const raw = await tx.getOwner(ownerUid, conversationId);
      if (raw === undefined) return { ok: false, error: "conversation_not_found" };

      tx.deleteOwner(ownerUid, conversationId);
      const participantUid = readableParticipantUid(raw);
      if (participantUid !== null) {
        tx.deleteParticipation(participantUid, conversationId);
      }
      return { ok: true };
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

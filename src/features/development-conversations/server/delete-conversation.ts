import "server-only";
import { writeRefusalFor } from "../../auth/server/erasure-write-fence";
import { isConversationId } from "../domain/conversation-id";
import { getDefaultConversationStore } from "./conversation-store";
import {
  type ErasureOwnerCleanupCapability,
  isErasureOwnerCleanupCapability,
} from "./erasure-owner-cleanup-capability";
import {
  assertUidSegment,
  type ConversationStore,
  type ConversationTransaction,
  type RawConversationData,
} from "./conversation-store-types";

/**
 * Owner hard delete (SPEC BR-5, BR-29, IMPL-1; TASK-010). One transaction removes the owner document and, when its
 * `participantUid` is readable, the participant index at that path. Delete reads plain fields only and never decrypts,
 * so a malformed or unreadable payload can still be deleted (BR-29). No tombstone is written.
 */

export interface DeleteConversationDeps {
  store: ConversationStore;
}

export type DeleteConversationResult =
  | { ok: true }
  | { ok: false; error: "conversation_not_found" | "erasure_in_progress" | "persistence_failed" };

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

/** The owner delete as one transaction. The caller chooses the transaction kind: the fence or, for erasure only, none. */
function deleteWork(ownerUid: string, conversationId: string) {
  return async (tx: ConversationTransaction): Promise<DeleteConversationResult> => {
    const raw = await tx.getOwner(ownerUid, conversationId);
    if (raw === undefined) return { ok: false, error: "conversation_not_found" };

    tx.deleteOwner(ownerUid, conversationId);
    const participantUid = readableParticipantUid(raw);
    if (participantUid !== null) {
      tx.deleteParticipation(participantUid, conversationId);
    }
    return { ok: true };
  };
}

/** Owner hard delete for ordinary callers. Always fenced by the owner's erasure record (BR-4(b)). */
export async function deleteConversation(
  ownerUid: string,
  conversationId: string,
  deps: DeleteConversationDeps = { store: getDefaultConversationStore() },
): Promise<DeleteConversationResult> {
  if (!isConversationId(conversationId)) return { ok: false, error: "conversation_not_found" };

  try {
    return await deps.store.runOwnerTransaction(ownerUid, deleteWork(ownerUid, conversationId));
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }
}

/**
 * The erasure owner cleanup's delete (TASK-027). The erased person's own erasure record must not refuse the erasure's own
 * delete, so it runs without the owner fence. Only a capability minted by the erasure cleanup is accepted. Any other value,
 * including a forged object, is refused before any read or write.
 */
export async function deleteConversationForErasure(
  capability: ErasureOwnerCleanupCapability,
  ownerUid: string,
  conversationId: string,
  store: ConversationStore,
): Promise<DeleteConversationResult> {
  if (!isErasureOwnerCleanupCapability(capability)) return { ok: false, error: "persistence_failed" };
  if (!isConversationId(conversationId)) return { ok: false, error: "conversation_not_found" };

  try {
    return await store.runErasureCleanupTransaction(capability, deleteWork(ownerUid, conversationId));
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }
}

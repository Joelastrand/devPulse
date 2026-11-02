import { isConversationId } from "../../development-conversations/domain/conversation-id";
import { deleteConversationForErasure } from "../../development-conversations/server/delete-conversation";
import { issueErasureOwnerCleanupCapability } from "../../development-conversations/server/erasure-owner-cleanup-capability";
import type { ConversationStore } from "../../development-conversations/server/conversation-store-types";
import { ErasureStepFailure, type BatchResult, type StepHandler } from "./erasure-runner";

/**
 * The `conversations_owned` and `locators` erasure steps (TASK-018; SPEC BR-8, D2 owned conversations, D4, AE-SI-6, I-5,
 * I-6). Both reuse the existing owner-delete core instead of duplicating its semantics.
 *
 * `conversations_owned`: every conversation in the erased person's owner subtree is deleted through `deleteConversation`,
 * which runs one transaction, removes the owner document (and with it the encrypted owner notes, next steps, participant
 * notes and shared goals it holds), and removes the participant's index entry. It reads plain fields only, so a malformed
 * owned conversation is still removed (BR-29). Participants lose the conversation; nobody is notified (D4).
 *
 * `locators`: the erased person's own participant index entries (the locator subtree; the store owns its path) are deleted, including
 * orphaned entries whose owner document no longer exists. Removing an entry grants nothing; it only removes a locator.
 *
 * Each batch handles one document. A listing that returns an id this step cannot act on (not a valid conversation id)
 * fails closed as `verification_failed`, so a bad id can never loop the step. `done` only when the listing is empty.
 */

/** Minted only here (static test). Without it the erasure's own owner delete cannot run unfenced (TASK-038 boundary). */
const ownerCleanupCapability = issueErasureOwnerCleanupCapability();

export interface ConversationsStepDeps {
  readonly store: ConversationStore;
}

export function createOwnedConversationsStepHandler(deps: ConversationsStepDeps): StepHandler {
  return {
    runBatch: ({ uid, maxWrites }) => runOwnedConversationsBatch(deps, uid, maxWrites),
  };
}

export function createLocatorsStepHandler(deps: ConversationsStepDeps): StepHandler {
  return {
    runBatch: ({ uid, maxWrites }) => runLocatorsBatch(deps, uid, maxWrites),
  };
}

export async function runOwnedConversationsBatch(
  deps: ConversationsStepDeps,
  uid: string,
  maxWrites: number,
): Promise<BatchResult> {
  // A zero budget could report "done" while a conversation remains, so it is a programming error, not a batch result.
  if (maxWrites < 1) throw new ErasureStepFailure("unexpected");

  const [next] = await deps.store.listOwnerIdsForErasure(uid, 1);
  if (next === undefined) return "done";
  if (!isConversationId(next)) throw new ErasureStepFailure("verification_failed");

  // The erasure's own owner cleanup is unfenced: the erased person's erasure record must not refuse it (TASK-027).
  const result = await deleteConversationForErasure(ownerCleanupCapability, uid, next, deps.store);
  if (result.ok || result.error === "conversation_not_found") return "more";
  // `persistence_failed`: the owner's conversation is still there, so the step is not complete and can be retried.
  throw new ErasureStepFailure("store_unavailable");
}

export async function runLocatorsBatch(deps: ConversationsStepDeps, uid: string, maxWrites: number): Promise<BatchResult> {
  if (maxWrites < 1) throw new ErasureStepFailure("unexpected");

  const [next] = await deps.store.listParticipationIdsForErasure(uid, 1);
  if (next === undefined) return "done";
  if (!isConversationId(next)) throw new ErasureStepFailure("verification_failed");

  try {
    await deps.store.runErasureCleanupTransaction(ownerCleanupCapability, async (tx) => {
      tx.deleteParticipation(uid, next);
    });
  } catch {
    throw new ErasureStepFailure("store_unavailable");
  }
  return "more";
}

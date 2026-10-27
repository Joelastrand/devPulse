import "server-only";
import { isConversationId } from "../domain/conversation-id";
import { classifyStoredShape } from "../domain/stored-owner-conversation";
import { getDefaultConversationStore } from "./conversation-store";
import type { ConversationStore, ConversationTransaction, OwnerDocumentPatch, RawConversationData } from "./conversation-store-types";

/**
 * Owner completion (SPEC BR-4, BR-13, BR-28, BR-48, BR-50 (1), CL-25, D2-SI-9; TASK-020). One transaction sets
 * `status: "completed"` and `completedAt`, and withdraws a pending invitation in the same commit (BR-13).
 *
 * Completion freezes content, never access. An accepted participant keeps access and their notes. The payload is not
 * rewritten, so the key is never probed or decrypted and completion works during a key outage (IMPL-1). A pending
 * withdrawal writes only plain fields and deletes the index entry, as TASK-016's decline does.
 *
 * Completion is owner-only. The owner uid is the first argument and is never read from the input. The transaction
 * re-reads the owner document, so a completion racing a participant write or an accept is resolved by commit order
 * (BR-50 (1)). Every refusal is a stable code and raw errors are never surfaced (BR-47).
 */

export interface CompleteConversationDeps {
  store: ConversationStore;
  /** Server time for `completedAt` and `updatedAt`. Injected so tests can fix it. */
  clock: () => Date;
}

export type CompleteConversationResult =
  | { ok: true }
  | { ok: false; error: "conversation_not_found" | "invalid_transition" | "persistence_failed" };

const OK: CompleteConversationResult = { ok: true };
const NOT_FOUND: CompleteConversationResult = { ok: false, error: "conversation_not_found" };
const INVALID_TRANSITION: CompleteConversationResult = { ok: false, error: "invalid_transition" };
const FAILED: CompleteConversationResult = { ok: false, error: "persistence_failed" };

/** The participant fields that a pending withdrawal clears. Written as `null`, never omitted (BR-16, BR-13). */
const CLEARED_PARTICIPANT_FIELDS = {
  participantUid: null,
  participantMemberRef: null,
  participantState: null,
  participantInvitedAt: null,
  participantAcceptedAt: null,
} as const;

function defaultDeps(): CompleteConversationDeps {
  return { store: getDefaultConversationStore(), clock: () => new Date() };
}

/**
 * Classifies the owner document that this transaction read and writes the completion. Only plain fields are classified,
 * so nothing decrypts (IMPL-1).
 */
function applyCompletion(
  tx: ConversationTransaction,
  ownerUid: string,
  conversationId: string,
  raw: RawConversationData | undefined,
  now: Date,
): CompleteConversationResult {
  if (raw === undefined) return NOT_FOUND;
  const shape = classifyStoredShape(raw);
  if (shape.kind !== "valid") return NOT_FOUND;
  const record = shape.record;

  // BR-4 and BR-28: `open → completed` is the only transition, so a second completion is refused without a write.
  if (record.status === "completed") return INVALID_TRANSITION;

  const patch: OwnerDocumentPatch = {
    status: "completed",
    completedAt: new Date(now.getTime()),
    updatedAt: new Date(now.getTime()),
  };

  // BR-13 and CL-25: a pending invitation is withdrawn in this same commit, so no access can start after completion.
  // An accepted participant is kept, and so is their content (BR-28, D2-SI-9). Neither case touches the payload.
  const participant = record.participant;
  if (participant !== null && participant.state === "pending") {
    Object.assign(patch, CLEARED_PARTICIPANT_FIELDS);
    tx.deleteParticipation(participant.uid, conversationId);
  }

  tx.updateOwner(ownerUid, conversationId, patch);
  return OK;
}

export async function completeConversation(
  ownerUid: string,
  conversationId: string,
  deps: CompleteConversationDeps = defaultDeps(),
): Promise<CompleteConversationResult> {
  // A malformed id cannot name a document, so it is refused before any read (D2-SI-15).
  if (!isConversationId(conversationId)) return NOT_FOUND;

  try {
    return await deps.store.runTransaction(async (tx) => {
      const raw = await tx.getOwner(ownerUid, conversationId);
      return applyCompletion(tx, ownerUid, conversationId, raw, deps.clock());
    });
  } catch {
    // Any read or write failure is operational. The raw error is never surfaced (BR-47).
    return FAILED;
  }
}

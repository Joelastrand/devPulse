
import type { ErasureOwnerCleanupCapability } from "../../development-conversations/server/erasure-owner-cleanup-capability";
import { isConversationId } from "../../development-conversations/domain/conversation-id";
import type { ConversationContent } from "../../development-conversations/domain/content-payload";
import type { ConversationStore, ConversationTransaction, OwnerDocumentPatch } from "../../development-conversations/server/conversation-store-types";
import type { EncodeContentResult } from "../../development-conversations/server/content-codec";
import { classifyOwnerDocument, type OwnerReadCodec } from "../../development-conversations/server/owner-read";
import { ErasureStepFailure, type BatchResult, type StepHandler } from "./erasure-runner";

/**
 * The `participant_bindings` erasure step (TASK-019; SPEC BR-9, D2 exception, I-7, I-8). The erased person is a participant
 * in a conversation OWNED BY SOMEONE ELSE. This is the erasure-only exception to the D2 completed-conversation rule: it runs
 * for completed conversations too. It is NOT a general mutation capability. Ordinary D2 APIs keep their own rules.
 *
 * For one conversation, in ONE store transaction (which spans the owner subtree and the participant index, BR-48):
 *   - the owner document must still bind the erased uid. If it does not (no participant, or another participant, that is
 *     a stale or already-cleaned binding), the owner document is not changed, and the erased person's index entry is removed;
 *   - otherwise the plain binding fields are cleared to null (participantUid, participantMemberRef, participantState,
 *     participantInvitedAt, participantAcceptedAt); the encrypted payload is decrypted with the production codec, its
 *     `participantNotes` is set to the empty note, and it is re-encrypted with the current key. Title, owner notes, next
 *     steps and shared goal snapshots are carried over exactly; `status` and `completedAt` are not touched; and the index
 *     entry in the erased person's subtree is deleted.
 *
 * Discovery (I-8) is a port. Production implements it as a collection-group query on the approved index (AE-IDX-1), wired
 * by TASK-038. It lives outside the D2 store on purpose: the D2 scope guard forbids collection groups in D2 production code.
 *
 * Fail closed: an undecryptable or malformed payload, or a malformed owner document, writes nothing and is
 * `payload_unreadable` (the resumable operator path). A key outage or any failure of the decrypt or encrypt seam writes
 * nothing and is `store_unavailable`, never reported as malformed data. Nothing is written before the payload has
 * decoded and re-encoded successfully. No notification, no erased uid or memberRef is written anywhere.
 */

export type ParticipantBindingFailure = "payload_unreadable" | "store_unavailable";

export type EraseParticipantBindingResult =
  | { ok: true; outcome: "cleaned" | "skipped" }
  | { ok: false; error: ParticipantBindingFailure };

/** A conversation owned by someone else in which a participant is bound (owner uid and conversation id only). */
export interface BoundConversation {
  readonly ownerUid: string;
  readonly conversationId: string;
}

/** Discovery of the conversations bound to a participant (I-8). Keys only, bounded by `limit`. */
export interface ParticipantBindingDiscovery {
  listBoundTo(uid: string, limit: number): Promise<BoundConversation[]>;
}

/** The codec this step needs: the classifier's decrypt seam (OwnerReadCodec) and the production encoder. */
export type ParticipantBindingCodec = OwnerReadCodec & { encodeContent(content: ConversationContent): EncodeContentResult };

export interface ParticipantBindingsDeps {
  readonly store: ConversationStore;
  /** Minted only by the approved erasure modules (see the static guard in delete-conversation-boundary.test.ts). */
  readonly cleanupCapability: ErasureOwnerCleanupCapability;
  readonly codec: ParticipantBindingCodec;
  readonly discovery: ParticipantBindingDiscovery;
  /** Server time for `updatedAt`, injected so tests can fix it. */
  readonly clock: () => Date;
}

/** The binding fields a removal clears. Written as null, never omitted, so no erased identity remains. */
const CLEARED_BINDING_FIELDS = {
  participantUid: null,
  participantMemberRef: null,
  participantState: null,
  participantInvitedAt: null,
  participantAcceptedAt: null,
} as const;

/** The erasure of the binding of `uid` on one conversation, in one transaction. */
export async function eraseParticipantBinding(
  deps: ParticipantBindingsDeps,
  binding: BoundConversation,
  uid: string,
): Promise<EraseParticipantBindingResult> {
  try {
    return await deps.store.runErasureCleanupTransaction(deps.cleanupCapability, (tx) => eraseInTransaction(tx, deps, binding, uid));
  } catch {
    // A store or key failure inside the transaction. No partial state is committed: the transaction did not complete.
    // This is deliberately broad, so a key outage is never mistaken for malformed data. Trade-off: a programmer error in
    // the store or codec also lands here and is retried by the runner's resumable path. TASK-038 must revisit it once the
    // real codec and store are wired.
    return { ok: false, error: "store_unavailable" };
  }
}

async function eraseInTransaction(
  tx: ConversationTransaction,
  deps: ParticipantBindingsDeps,
  binding: BoundConversation,
  uid: string,
): Promise<EraseParticipantBindingResult> {
  const { ownerUid, conversationId } = binding;

  const raw = await tx.getOwner(ownerUid, conversationId);
  if (raw === undefined) {
    // The owner document is gone, so the only remaining locator is the erased person's own index entry (orphan).
    tx.deleteParticipation(uid, conversationId);
    return { ok: true, outcome: "skipped" };
  }

  // The decrypt seam may throw on a key outage. That is an operational failure, so it is reported as one, below.
  const classification = classifyOwnerDocument(raw, deps.codec);
  if (classification.kind !== "valid") {
    return { ok: false, error: "payload_unreadable" };
  }
  const record = classification.record;

  if (record.participant === null || record.participant.uid !== uid) {
    // Already cleaned, or a stale binding that names someone else: the owner document is not changed. Only the erased
    // person's own locator is removed, so no index entry can grant access.
    tx.deleteParticipation(uid, conversationId);
    return { ok: true, outcome: "skipped" };
  }

  const encoded = deps.codec.encodeContent({ ...record.content, participantNotes: "" });
  if (!encoded.ok) {
    return { ok: false, error: "store_unavailable" };
  }

  const patch: OwnerDocumentPatch = {
    ...CLEARED_BINDING_FIELDS,
    updatedAt: new Date(deps.clock().getTime()),
    ...encoded.content,
  };
  tx.updateOwner(ownerUid, conversationId, patch);
  tx.deleteParticipation(uid, conversationId);
  return { ok: true, outcome: "cleaned" };
}

/**
 * One batch: take the first conversation still bound to `uid` and clean it. A cleaned binding no longer matches the
 * discovery, so the step reaches `done` when nothing is bound. A conversation that the discovery returns but that is
 * already gone or stale is `skipped`. Its index entry for `uid` is deleted in the same transaction, so it cannot be
 * returned again for the same conversation; the runner's per-request budget bounds any other repetition.
 */
export async function runParticipantBindingsBatch(
  deps: ParticipantBindingsDeps,
  uid: string,
  maxWrites: number,
): Promise<BatchResult> {
  // A zero budget could report "done" while a binding remains, so it is a programming error, not a batch result.
  if (maxWrites < 1) throw new ErasureStepFailure("unexpected");

  const [next] = await deps.discovery.listBoundTo(uid, 1);
  if (next === undefined) return "done";
  if (!isConversationId(next.conversationId)) throw new ErasureStepFailure("verification_failed");

  const result = await eraseParticipantBinding(deps, next, uid);
  if (!result.ok) throw new ErasureStepFailure(result.error);
  return "more";
}

export function createParticipantBindingsStepHandler(deps: ParticipantBindingsDeps): StepHandler {
  return {
    runBatch: ({ uid, maxWrites }) => runParticipantBindingsBatch(deps, uid, maxWrites),
  };
}

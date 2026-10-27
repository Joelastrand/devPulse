import "server-only";
import { isConversationId } from "../domain/conversation-id";
import type { ConversationContent } from "../domain/content-payload";
import { classifyStoredShape } from "../domain/stored-owner-conversation";
import { normalizeNote } from "../domain/text-rules";
import { authorizeParticipant, participantOwnerUid } from "./authorize-participant";
import {
  decryptForClassification as decryptForClassificationWithKey,
  encodeContent as encodeContentWithKey,
  probeKey as probeKeyOnce,
  type EncodeContentResult,
} from "./content-codec";
import { getDefaultConversationStore } from "./conversation-store";
import type { ConversationStore, ConversationTransaction, RawConversationData } from "./conversation-store-types";
import { classifyOwnerDocument, type OwnerReadCodec } from "./owner-read";
import { readGenuineActiveMembership } from "./team-eligibility";

/**
 * Participant notes write (SPEC BR-20, BR-21, BR-28, BR-48, BR-49, BR-50 (1) and (2), BR-53, D2-SI-7, IMPL-1; TASK-019).
 * The only content write a participant can make. The participant replaces `participantNotes` in the encrypted payload
 * (last write wins, empty clears). Every other owner section is carried over unchanged.
 *
 * The caller's uid is the first argument and is never read from the input. The owner has no branch here: the owner's
 * uid has no index entry at its own path, so it gets `conversation_not_found`. The access decision re-runs inside the
 * transaction (BR-48), so a removal or completion that committed after the request began is seen. A key outage or an
 * unreadable payload writes nothing. Every refusal is a stable code and raw errors are never surfaced (BR-47).
 */

/** The codec operations this write needs: the probe, the classifier's decrypt seam and the encoder. */
export interface WriteParticipantNotesCodec extends OwnerReadCodec {
  encodeContent(content: ConversationContent): EncodeContentResult;
}

export interface WriteParticipantNotesDeps {
  store: ConversationStore;
  codec: WriteParticipantNotesCodec;
  /** Server time for `updatedAt` (BR-2 pattern). Injected so tests can fix it. */
  clock: () => Date;
}

export type WriteParticipantNotesResult =
  | { ok: true }
  | { ok: false; error: "invalid_input"; field: "notes" }
  | { ok: false; error: "conversation_not_found" | "conversation_completed" | "persistence_failed" };

const OK: WriteParticipantNotesResult = { ok: true };
const NOT_FOUND: WriteParticipantNotesResult = { ok: false, error: "conversation_not_found" };
const COMPLETED: WriteParticipantNotesResult = { ok: false, error: "conversation_completed" };
const FAILED: WriteParticipantNotesResult = { ok: false, error: "persistence_failed" };
const INVALID_NOTES: WriteParticipantNotesResult = { ok: false, error: "invalid_input", field: "notes" };

function defaultDeps(): WriteParticipantNotesDeps {
  return {
    store: getDefaultConversationStore(),
    codec: { probeKey: probeKeyOnce, decryptForClassification: decryptForClassificationWithKey, encodeContent: encodeContentWithKey },
    clock: () => new Date(),
  };
}

async function writeInTransaction(
  tx: ConversationTransaction,
  callerUid: string,
  conversationId: string,
  notes: string,
  deps: WriteParticipantNotesDeps,
): Promise<WriteParticipantNotesResult> {
  // BR-21 (a): the caller's index entry must exist and name a usable owner.
  const rawIndex = await tx.getParticipation(callerUid, conversationId);
  if (rawIndex === undefined) return NOT_FOUND;
  const ownerUid = participantOwnerUid(rawIndex);
  if (ownerUid === null) return NOT_FOUND;

  // BR-21 (b): the owner document must parse as a valid plain shape. Nothing is decrypted yet.
  const raw: RawConversationData | undefined = await tx.getOwner(ownerUid, conversationId);
  if (raw === undefined) return NOT_FOUND;
  const shape = classifyStoredShape(raw);
  if (shape.kind !== "valid" || shape.record.teamId === null) return NOT_FOUND;

  // BR-48, BR-21 (d) and (e): the team and the caller's current genuine membership, read through this attempt's
  // transaction. A retry repeats this read, so no eligibility is carried over from an earlier attempt. A failed read is operational.
  const membership = await readGenuineActiveMembership(callerUid, shape.record.teamId, tx.teamEligibility);
  if (!membership.ok && membership.error === "read_failed") return FAILED;

  // BR-21 (a) to (e): the single decision. Every denial is the same not-found result.
  const decision = authorizeParticipant({ callerUid, index: rawIndex, owner: raw, membership });
  if (!decision.allowed) return NOT_FOUND;

  // BR-28: `participantNotes` is frozen after completion. The status is plain, so it is checked before any decryption.
  if (shape.record.status === "completed") return COMPLETED;

  // BR-53: the key is probed after authorization, as in TASK-017, so an unauthorized caller never sees key state.
  if (!deps.codec.probeKey().ok) return FAILED;

  // IMPL-1: the rewrite needs the decrypted payload. A key failure throws out of the classifier and is caught by the caller.
  const classification = classifyOwnerDocument(raw, deps.codec);
  if (classification.kind !== "valid") return NOT_FOUND;

  // Only `participantNotes` changes. Owner sections are carried over unchanged (BR-49, D2-SI-7).
  const content: ConversationContent = { ...classification.record.content, participantNotes: notes };
  const encoded = deps.codec.encodeContent(content);
  if (!encoded.ok) return FAILED;

  tx.updateOwner(ownerUid, conversationId, {
    updatedAt: new Date(deps.clock().getTime()),
    ...encoded.content,
  });
  return OK;
}

export async function writeParticipantNotes(
  callerUid: string,
  conversationId: string,
  notes: unknown,
  deps: WriteParticipantNotesDeps = defaultDeps(),
): Promise<WriteParticipantNotesResult> {
  // BR-20 and TASK-001: the value is plain text within `NOTE_MAX_BYTES`, and may be empty. Refused before any read.
  const parsed = normalizeNote(notes);
  if (!parsed.ok) return INVALID_NOTES;

  // A malformed id cannot name a document, so it is refused before any read (D2-SI-15).
  if (!isConversationId(conversationId)) return NOT_FOUND;

  try {
    return await deps.store.runTransaction((tx) => writeInTransaction(tx, callerUid, conversationId, parsed.text, deps));
  } catch {
    // Any read, key or write failure is operational. The raw error is never surfaced (BR-47).
    return FAILED;
  }
}

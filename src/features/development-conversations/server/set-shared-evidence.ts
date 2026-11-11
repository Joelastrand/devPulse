import "server-only";
import { writeRefusalFor } from "../../auth/server/erasure-write-fence";
import { isConversationId } from "../domain/conversation-id";
import type { ConversationErrorCode } from "../domain/errors";
import { parseEvidenceSelection, type EvidenceSelection } from "../domain/evidence-selection";
import type { SharedEvidenceSnapshot } from "../domain/shared-evidence-snapshot";
import type { ConversationStore } from "./conversation-store-types";
import { classifyOwnerDocument } from "./owner-read";
import type { UpdateOwnerSectionsCodec } from "./update-owner-sections";
import { readOwnedEvidenceSnapshots, type OwnedEvidenceReader } from "./owned-evidence-seam";

/**
 * Owner evidence-selection write (SPEC BR-40 to BR-45, BR-48, BR-50; SECURITY-REVIEW §11.2, W-21, N-E6 to N-E8; TASK-007).
 * The owner replaces the whole `sharedEvidence` set in one transaction. The snapshots are built on the server from the owner's
 * own records and stored only inside the encrypted payload. A client never supplies snapshot content.
 *
 * Order: conversation id, key probe, selection validation (no reads on failure), source reads, then one fenced transaction that
 * re-checks status and writes. An empty selection is the clear request and reads nothing. After completion, only the clear
 * request is allowed (BR-48). The owner uid is the first argument and is never read from the input.
 */

export interface SetSharedEvidenceDeps {
  store: ConversationStore;
  codec: UpdateOwnerSectionsCodec;
  reader: OwnedEvidenceReader;
  /** Server time for `updatedAt` and `capturedAt`. Injected so tests can fix it. */
  clock: () => Date;
}

export type SetSharedEvidenceResult =
  | { ok: true }
  | {
      ok: false;
      error: Extract<
        ConversationErrorCode,
        | "conversation_not_found"
        | "conversation_completed"
        | "conversation_changed"
        | "invalid_input"
        | "invalid_evidence_selection"
        | "persistence_failed"
      > | "erasure_in_progress";
    };

const NOT_FOUND: SetSharedEvidenceResult = { ok: false, error: "conversation_not_found" };
const FAILED: SetSharedEvidenceResult = { ok: false, error: "persistence_failed" };
const INVALID: SetSharedEvidenceResult = { ok: false, error: "invalid_evidence_selection" };
const BAD_PRECONDITION: SetSharedEvidenceResult = { ok: false, error: "invalid_input" };
const CHANGED: SetSharedEvidenceResult = { ok: false, error: "conversation_changed" };
const REFUSED: SetSharedEvidenceResult = { ok: false, error: "erasure_in_progress" };

const isClear = (selection: EvidenceSelection) => selection.responsibilityIds.length === 0 && selection.achievementIds.length === 0;

/**
 * The owner's view version (E-1). The client echoes the `updatedAt` it last read, as the canonical ISO string the DTO carries.
 * Anything else, including a non-canonical date, is refused before any read.
 */
function parseExpectedUpdatedAt(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) return null;
  return date;
}

export async function setSharedEvidence(
  ownerUid: string,
  conversationId: string,
  rawSelection: unknown,
  rawExpectedUpdatedAt: unknown,
  deps: SetSharedEvidenceDeps,
): Promise<SetSharedEvidenceResult> {
  // A malformed id cannot name a document, so it is refused before any read (D2-SI-15).
  if (!isConversationId(conversationId)) return NOT_FOUND;
  // BR-53: the key probe runs before any document or source record is read.
  if (!deps.codec.probeKey().ok) return FAILED;

  // BR-42, N-E6, N-E7: the shape, the ids and the per-type limits are validated before any source read.
  const selection = parseEvidenceSelection(rawSelection);
  if (selection === null) return INVALID;
  // E-1: the version precondition is required and is checked inside the write transaction below.
  const expectedUpdatedAt = parseExpectedUpdatedAt(rawExpectedUpdatedAt);
  if (expectedUpdatedAt === null) return BAD_PRECONDITION;

  try {
    let snapshots: SharedEvidenceSnapshot[] = [];
    if (!isClear(selection)) {
      const read = await readOwnedEvidenceSnapshots(ownerUid, selection, { reader: deps.reader, clock: deps.clock });
      if (!read.ok) return { ok: false, error: read.error };
      snapshots = read.snapshots;
    }

    const now = deps.clock();
    return await deps.store.runOwnerTransaction(ownerUid, async (tx): Promise<SetSharedEvidenceResult> => {
      const raw = await tx.getOwner(ownerUid, conversationId);
      if (raw === undefined) return NOT_FOUND;

      const classification = classifyOwnerDocument(raw, deps.codec);
      if (classification.kind !== "valid") return NOT_FOUND;
      const record = classification.record;

      // E-1: a conversation change since the owner's read (any write advances `updatedAt`) makes this selection stale. The
      // comparison and the write share one transaction, so a stale write can never overwrite a newer one.
      if (record.updatedAt.getTime() !== expectedUpdatedAt.getTime()) return CHANGED;

      // BR-48, Amendment D: after completion only the whole-set clear is allowed. The status is read inside the transaction.
      if (record.status === "completed" && snapshots.length > 0) return { ok: false, error: "conversation_completed" };

      // Only `sharedEvidence` changes. Every other encrypted field, including `sharedGoals`, is carried over unchanged (BR-49).
      const encoded = deps.codec.encodeContent({
        title: record.content.title,
        ownerNotes: record.content.ownerNotes,
        nextSteps: record.content.nextSteps,
        participantNotes: record.content.participantNotes,
        sharedGoals: record.content.sharedGoals,
        sharedEvidence: snapshots,
      });
      if (!encoded.ok) return FAILED;

      tx.updateOwner(ownerUid, conversationId, { updatedAt: new Date(now.getTime()), ...encoded.content });
      return { ok: true };
    });
  } catch (error) {
    // Any read, key or write failure is operational and its raw error is never surfaced (BR-47). A fence refusal is its own code.
    return writeRefusalFor(error) === "erasure_in_progress" ? REFUSED : FAILED;
  }
}

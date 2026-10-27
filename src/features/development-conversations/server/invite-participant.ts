import "server-only";
import { PARTICIPATION_LIMIT } from "../domain/conversation-constants";
import { isConversationId } from "../domain/conversation-id";
import { probeKey as probeKeyOnce, decryptForClassification as decryptForClassificationWithKey } from "./content-codec";
import { getDefaultConversationStore } from "./conversation-store";
import type { ConversationStore } from "./conversation-store-types";
import { resolveParticipantRef, createFirestoreParticipantRefReader, type ParticipantRefReader } from "./member-ref-binding";
import { classifyOwnerDocument, type OwnerReadCodec } from "./owner-read";

/**
 * Pending invitation (SPEC BR-7 to BR-11, BR-32, BR-37, BR-48, BR-50 (6), AD-11, CL-2, CL-25, D2-SI-4; TASK-014). The owner
 * sets one participant by `memberRef`. The owner document and the candidate's participation index are written in one
 * transaction. Every rejection is `invalid_participant`, except the stable codes for a missing conversation, a completed
 * conversation and an operational failure.
 *
 * Order: the conversation is read and classified first, because the team id is needed to resolve the ref. The ref is
 * then resolved through TASK-007, which carries the owner and candidate eligibility checks (BR-9). The participation cap
 * is counted before the transaction (count-then-create, BR-37). The transaction re-reads the owner document and checks
 * completion, team and the absence of a participant (BR-10, BR-11). The owner uid is the first argument and is never
 * read from the input. The candidate uid is written to server-side fields only, and is never returned.
 */

export interface InviteParticipantDeps {
  store: ConversationStore;
  codec: OwnerReadCodec;
  /** The TASK-007 reference seam: the TASK-006 point reads plus one bounded membership list. */
  refReader: ParticipantRefReader;
  /** Server time for `participantInvitedAt` and `updatedAt`. Injected so tests can fix it. */
  clock: () => Date;
}

export type InviteParticipantResult =
  | { ok: true }
  | { ok: false; error: "invalid_participant" | "conversation_completed" | "conversation_not_found" | "persistence_failed" };

const NOT_FOUND: InviteParticipantResult = { ok: false, error: "conversation_not_found" };
const INVALID: InviteParticipantResult = { ok: false, error: "invalid_participant" };
const COMPLETED: InviteParticipantResult = { ok: false, error: "conversation_completed" };
const FAILED: InviteParticipantResult = { ok: false, error: "persistence_failed" };

function defaultDeps(): InviteParticipantDeps {
  return {
    store: getDefaultConversationStore(),
    codec: { probeKey: probeKeyOnce, decryptForClassification: decryptForClassificationWithKey },
    refReader: createFirestoreParticipantRefReader(),
    clock: () => new Date(),
  };
}

export async function inviteParticipant(
  ownerUid: string,
  conversationId: string,
  memberRef: unknown,
  deps: InviteParticipantDeps = defaultDeps(),
): Promise<InviteParticipantResult> {
  // A malformed id cannot name a document, so it is refused before any read (D2-SI-15).
  if (!isConversationId(conversationId)) return NOT_FOUND;
  // BR-53: the key probe runs before any document is read or written.
  if (!deps.codec.probeKey().ok) return FAILED;

  try {
    const before = await deps.store.getOwner(ownerUid, conversationId);
    if (before === undefined) return NOT_FOUND;
    const classification = classifyOwnerDocument(before, deps.codec);
    if (classification.kind !== "valid") return NOT_FOUND;

    // BR-2: a conversation without a team can never have a participant, and there is no team to resolve against.
    const teamId = classification.record.teamId;
    if (teamId === null) return INVALID;

    const resolved = await resolveParticipantRef(ownerUid, teamId, memberRef, deps.refReader);
    if (!resolved.ok) return { ok: false, error: resolved.error };

    // BR-37: count-then-create. A small overshoot under concurrency is accepted, as in D1.
    const count = await deps.store.countParticipation(resolved.candidateUid);
    if (count >= PARTICIPATION_LIMIT) return INVALID;

    const now = deps.clock();
    return await deps.store.runTransaction(async (tx): Promise<InviteParticipantResult> => {
      const raw = await tx.getOwner(ownerUid, conversationId);
      if (raw === undefined) return NOT_FOUND;
      const classified = classifyOwnerDocument(raw, deps.codec);
      if (classified.kind !== "valid") return NOT_FOUND;
      const record = classified.record;

      // BR-10: the invitation is allowed only while open. The status is read here, inside the transaction (BR-50 (6)).
      if (record.status === "completed") return COMPLETED;
      // The team is immutable (BR-2), so a mismatch with the resolved team is refused rather than repaired.
      if (record.teamId !== teamId) return INVALID;
      // BR-11 and BR-10: a participant, pending or accepted, is replaced only through TASK-018.
      if (record.participant !== null) return INVALID;

      tx.updateOwner(ownerUid, conversationId, {
        participantUid: resolved.candidateUid,
        participantMemberRef: resolved.memberRef,
        participantState: "pending",
        participantInvitedAt: new Date(now.getTime()),
        updatedAt: new Date(now.getTime()),
      });
      tx.setParticipation(resolved.candidateUid, conversationId, { ownerUid, invitedAt: new Date(now.getTime()) });
      return { ok: true };
    });
  } catch {
    // Any read, key or write failure is operational. The raw error is never surfaced (BR-47).
    return FAILED;
  }
}

import "server-only";
import { isConversationId } from "../domain/conversation-id";
import type { ConversationContent } from "../domain/content-payload";
import { isPlainObject } from "../domain/stored-shape";
import { classifyStoredShape } from "../domain/stored-owner-conversation";
import { parseStoredParticipationIndex } from "../domain/stored-participation-index";
import {
  decryptForClassification as decryptForClassificationWithKey,
  encodeContent as encodeContentWithKey,
  probeKey as probeKeyOnce,
  type EncodeContentResult,
} from "./content-codec";
import { getDefaultConversationStore } from "./conversation-store";
import {
  assertUidSegment,
  type ConversationStore,
  type ConversationTransaction,
  type RawConversationData,
} from "./conversation-store-types";
import { bindingMatches } from "./member-ref-binding";
import { classifyOwnerDocument, type OwnerReadCodec } from "./owner-read";
import { readGenuineActiveMembership } from "./team-eligibility";

/**
 * Participant responses (SPEC BR-15, BR-17, BR-18, BR-48, BR-50 (3), CL-21, IMPL-1, D2-SI-3, D2-SI-8; TASK-016).
 *
 * `acceptInvitation` moves a pending invitation to accepted. It re-checks every SPEC condition inside one transaction and
 * writes plain fields only, so it never decrypts and works during a key outage.
 *
 * `leaveParticipation` ends access for the caller. Decline (pending) and leave (accepted, open or completed, eligible or
 * not) share one path. The participant's notes are removed from the encrypted payload, so the path decrypts and
 * re-encrypts it first (IMPL-1). A key outage or an unreadable payload writes nothing. Eligibility is never checked on
 * this path (BR-18). A stale index entry is deleted without other effect (BR-17).
 *
 * The caller's uid is the first argument and is never read from the input. Every refusal is `conversation_not_found`,
 * except an operational failure, which is `persistence_failed` (BR-47). Raw errors are never surfaced.
 */

export interface RespondToParticipationDeps {
  store: ConversationStore;
  /** The codec operations the leave path needs: the probe, the classifier's decrypt seam and the encoder. */
  codec: OwnerReadCodec & { encodeContent(content: ConversationContent): EncodeContentResult };
  /** Server time for `participantAcceptedAt` and `updatedAt`. Injected so tests can fix it. */
  clock: () => Date;
}

export type RespondToParticipationResult = { ok: true } | { ok: false; error: "conversation_not_found" | "persistence_failed" };

const NOT_FOUND: RespondToParticipationResult = { ok: false, error: "conversation_not_found" };
const FAILED: RespondToParticipationResult = { ok: false, error: "persistence_failed" };

/** The participant fields that a leave clears. Written as `null`, never omitted (BR-16, BR-17). */
const CLEARED_PARTICIPANT_FIELDS = {
  participantUid: null,
  participantMemberRef: null,
  participantState: null,
  participantInvitedAt: null,
  participantAcceptedAt: null,
} as const;

function defaultDeps(): RespondToParticipationDeps {
  return {
    store: getDefaultConversationStore(),
    codec: { probeKey: probeKeyOnce, decryptForClassification: decryptForClassificationWithKey, encodeContent: encodeContentWithKey },
    clock: () => new Date(),
  };
}

function isUidSegment(uid: string): boolean {
  try {
    assertUidSegment(uid);
    return true;
  } catch {
    return false;
  }
}

/** True when the raw owner document names `callerUid` as its participant. Used only for the stale-index decision. */
function namesCaller(raw: unknown, callerUid: string): boolean {
  return isPlainObject(raw) && raw.participantUid === callerUid;
}

export async function acceptInvitation(
  callerUid: string,
  conversationId: string,
  deps: RespondToParticipationDeps = defaultDeps(),
): Promise<RespondToParticipationResult> {
  // A malformed id cannot name a document, so it is refused before any read (D2-SI-15).
  if (!isConversationId(conversationId)) return NOT_FOUND;

  try {
    return await deps.store.runTransaction(async (tx): Promise<RespondToParticipationResult> => {
      // BR-15: the caller's index entry must exist and name a valid owner.
      const rawIndex = await tx.getParticipation(callerUid, conversationId);
      if (rawIndex === undefined) return NOT_FOUND;
      const index = parseStoredParticipationIndex(rawIndex);
      if (!index.ok || !isUidSegment(index.entry.ownerUid)) return NOT_FOUND;
      const ownerUid = index.entry.ownerUid;

      // BR-15: the owner document names the caller as a pending participant. Plain fields only, so no decryption.
      const raw = await tx.getOwner(ownerUid, conversationId);
      if (raw === undefined) return NOT_FOUND;
      const classification = classifyStoredShape(raw);
      if (classification.kind !== "valid") return NOT_FOUND;
      const participant = classification.record.participant;
      if (participant === null || participant.uid !== callerUid || participant.state !== "pending") return NOT_FOUND;
      const teamId = classification.record.teamId;
      if (teamId === null) return NOT_FOUND;

      // BR-48, BR-9 and BR-21 (d) and (e): an active team, a current genuine membership, and the bound memberRef still
      // equal. Both reads go through this attempt's transaction, so a retry repeats them (no cache across attempts).
      const membership = await readGenuineActiveMembership(callerUid, teamId, tx.teamEligibility);
      if (!membership.ok) return membership.error === "read_failed" ? FAILED : NOT_FOUND;
      if (!bindingMatches(participant.memberRef, membership)) return NOT_FOUND;

      const now = deps.clock();
      tx.updateOwner(ownerUid, conversationId, {
        participantState: "accepted",
        participantAcceptedAt: new Date(now.getTime()),
        updatedAt: new Date(now.getTime()),
      });
      return { ok: true };
    });
  } catch {
    // Any read or write failure is operational. The raw error is never surfaced (BR-47).
    return FAILED;
  }
}

/**
 * Pending decline (BR-17, locked reconciliation of IMPL-1). The invitation was never accepted, so there is no content to
 * remove. The key is neither probed nor used, and the encrypted payload is not written. Clearing the binding and the
 * index is an access-state change only.
 */
function declinePending(tx: ConversationTransaction, ownerUid: string, callerUid: string, conversationId: string, now: Date): void {
  tx.updateOwner(ownerUid, conversationId, {
    ...CLEARED_PARTICIPANT_FIELDS,
    updatedAt: new Date(now.getTime()),
  });
  tx.deleteParticipation(callerUid, conversationId);
}

/**
 * Accepted self-leave (BR-17, BR-18, CL-21, IMPL-1). The key is probed (BR-53) and the payload is decrypted and validated
 * before anything is buffered. Only `participantNotes` is replaced, so owner content is carried over unchanged. A key
 * failure throws out of the classifier and is caught by the caller. Eligibility is never read here (BR-18).
 */
function leaveAccepted(
  tx: ConversationTransaction,
  ownerUid: string,
  callerUid: string,
  conversationId: string,
  raw: RawConversationData,
  deps: RespondToParticipationDeps,
  now: Date,
): RespondToParticipationResult {
  if (!deps.codec.probeKey().ok) return FAILED;

  // IMPL-1: an unreadable or malformed payload writes nothing. It is never replaced with a blank payload.
  const classification = classifyOwnerDocument(raw, deps.codec);
  if (classification.kind !== "valid") return NOT_FOUND;

  // BR-16 effects: the notes are deleted (written as the empty note), owner content is carried over unchanged.
  const content: ConversationContent = { ...classification.record.content, participantNotes: "" };
  const encoded = deps.codec.encodeContent(content);
  if (!encoded.ok) return FAILED;

  tx.updateOwner(ownerUid, conversationId, {
    ...CLEARED_PARTICIPANT_FIELDS,
    updatedAt: new Date(now.getTime()),
    ...encoded.content,
  });
  tx.deleteParticipation(callerUid, conversationId);
  return { ok: true };
}

export async function leaveParticipation(
  callerUid: string,
  conversationId: string,
  deps: RespondToParticipationDeps = defaultDeps(),
): Promise<RespondToParticipationResult> {
  // A malformed id cannot name a document, so it is refused before any read (D2-SI-15).
  if (!isConversationId(conversationId)) return NOT_FOUND;

  try {
    return await deps.store.runTransaction(async (tx): Promise<RespondToParticipationResult> => {
      // BR-17 step 1: the caller's index entry is required.
      const rawIndex = await tx.getParticipation(callerUid, conversationId);
      if (rawIndex === undefined) return NOT_FOUND;
      const index = parseStoredParticipationIndex(rawIndex);
      if (!index.ok || !isUidSegment(index.entry.ownerUid)) return NOT_FOUND;
      const ownerUid = index.entry.ownerUid;

      // BR-17 step 2: if the owner document does not name the caller, only the stale index entry is removed. Nothing
      // else in the owner document is read for a write, so another participant's state is never touched.
      const raw = await tx.getOwner(ownerUid, conversationId);
      if (raw === undefined || !namesCaller(raw, callerUid)) {
        tx.deleteParticipation(callerUid, conversationId);
        return { ok: true };
      }

      // The caller's own binding must be canonical before either branch writes. Plain fields only, so the branch can be
      // chosen without the key.
      const shape = classifyStoredShape(raw);
      if (shape.kind !== "valid") return NOT_FOUND;
      const participant = shape.record.participant;
      if (participant === null || participant.uid !== callerUid) return NOT_FOUND;

      const now = deps.clock();
      if (participant.state === "pending") {
        declinePending(tx, ownerUid, callerUid, conversationId, now);
        return { ok: true };
      }
      return leaveAccepted(tx, ownerUid, callerUid, conversationId, raw, deps, now);
    });
  } catch {
    // Any read, key or write failure is operational. The raw error is never surfaced (BR-47).
    return FAILED;
  }
}

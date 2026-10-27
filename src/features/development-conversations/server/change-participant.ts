import "server-only";
import { PARTICIPATION_LIMIT } from "../domain/conversation-constants";
import { isConversationId } from "../domain/conversation-id";
import type { ConversationContent } from "../domain/content-payload";
import { isPlainObject } from "../domain/stored-shape";
import {
  decryptForClassification as decryptForClassificationWithKey,
  encodeContent as encodeContentWithKey,
  probeKey as probeKeyOnce,
  type EncodeContentResult,
} from "./content-codec";
import { getDefaultConversationStore } from "./conversation-store";
import type { ConversationStore, ConversationTransaction, OwnerDocumentPatch } from "./conversation-store-types";
import { createFirestoreParticipantRefReader, resolveParticipantRef, type ParticipantRefReader } from "./member-ref-binding";
import { classifyOwnerDocument, type OwnerReadCodec } from "./owner-read";

/**
 * Owner removal and replacement (SPEC BR-10, BR-16, BR-18, BR-48, BR-50 (3) and (6), CL-21, IMPL-1, D2-SI-8; TASK-018).
 * The owner sets `participantMemberRef` to `null` to remove the current participant, or to a new ref to replace it.
 *
 * Removal is allowed in `open` and `completed`, with no eligibility check (BR-18). It clears the participant fields,
 * deletes the old index entry and deletes `participantNotes` by re-encrypting the payload (IMPL-1). A key outage or an
 * unreadable payload writes nothing. Removing a missing participant is an idempotent no-op.
 *
 * A new ref is allowed only while `open` (BR-16). It is resolved and counted before the transaction, as in TASK-014, and
 * the transaction re-reads the owner document and writes the removal effects (when a participant exists) and the new
 * pending invitation together. With no current participant, a ref writes only the invitation.
 *
 * The owner uid is the first argument and is never read from the input. Every refusal is one of the stable codes.
 * Raw errors are never surfaced (BR-47).
 */

export interface ChangeParticipantDeps {
  store: ConversationStore;
  /** The codec operations this path needs: the probe, the classifier's decrypt seam and the encoder. */
  codec: OwnerReadCodec & { encodeContent(content: ConversationContent): EncodeContentResult };
  /** The TASK-007 reference seam, used only to resolve a replacement candidate. */
  refReader: ParticipantRefReader;
  /** Server time for `participantInvitedAt` and `updatedAt`. Injected so tests can fix it. */
  clock: () => Date;
}

/**
 * `noop: true` marks the idempotent removal of a missing participant: a successful call that wrote nothing (BR-16, TASK-023
 * I-1). It is additive: every caller that reads only `ok` is unaffected, and a real change never sets it.
 */
export type ChangeParticipantResult =
  | { ok: true; noop?: true }
  | {
      ok: false;
      error: "invalid_input" | "invalid_participant" | "conversation_completed" | "conversation_not_found" | "persistence_failed";
    };

const OK: ChangeParticipantResult = { ok: true };
const NOOP: ChangeParticipantResult = { ok: true, noop: true };
const NOT_FOUND: ChangeParticipantResult = { ok: false, error: "conversation_not_found" };
const INVALID: ChangeParticipantResult = { ok: false, error: "invalid_participant" };
const INPUT_INVALID: ChangeParticipantResult = { ok: false, error: "invalid_input" };
const COMPLETED: ChangeParticipantResult = { ok: false, error: "conversation_completed" };
const FAILED: ChangeParticipantResult = { ok: false, error: "persistence_failed" };

/** The participant fields that a removal or replacement clears first. Written as `null`, never omitted (BR-16). */
const CLEARED_PARTICIPANT_FIELDS = {
  participantUid: null,
  participantMemberRef: null,
  participantState: null,
  participantInvitedAt: null,
  participantAcceptedAt: null,
} as const;

function defaultDeps(): ChangeParticipantDeps {
  return {
    store: getDefaultConversationStore(),
    codec: { probeKey: probeKeyOnce, decryptForClassification: decryptForClassificationWithKey, encodeContent: encodeContentWithKey },
    refReader: createFirestoreParticipantRefReader(),
    clock: () => new Date(),
  };
}

/** The input is exactly `{ participantMemberRef }`. The ref itself is validated by the resolver, not here. */
function parseChangeInput(input: unknown): { ok: true; memberRef: unknown } | { ok: false } {
  if (!isPlainObject(input)) return { ok: false };
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== "participantMemberRef") return { ok: false };
  return { ok: true, memberRef: input.participantMemberRef };
}

/** The owner content with `participantNotes` deleted. Owner content is carried over unchanged (BR-16). */
function encodeWithoutParticipantNotes(content: ConversationContent, deps: ChangeParticipantDeps): EncodeContentResult {
  return deps.codec.encodeContent({ ...content, participantNotes: "" });
}

interface PreparedReplacement {
  teamId: string;
  candidateUid: string;
  memberRef: string;
}

/**
 * The checks that run before the transaction (TASK-014 order): the conversation is read and classified, the team id is
 * needed to resolve the ref, the candidate passes TASK-007, and the cap is counted (BR-37). A refusal carries its result.
 */
async function prepareReplacement(
  ownerUid: string,
  conversationId: string,
  memberRef: unknown,
  deps: ChangeParticipantDeps,
): Promise<{ ok: true; replacement: PreparedReplacement } | { ok: false; result: ChangeParticipantResult }> {
  const before = await deps.store.getOwner(ownerUid, conversationId);
  if (before === undefined) return { ok: false, result: NOT_FOUND };
  const classification = classifyOwnerDocument(before, deps.codec);
  if (classification.kind !== "valid") return { ok: false, result: NOT_FOUND };

  const teamId = classification.record.teamId;
  if (teamId === null) return { ok: false, result: INVALID };

  const resolved = await resolveParticipantRef(ownerUid, teamId, memberRef, deps.refReader);
  if (!resolved.ok) return { ok: false, result: { ok: false, error: resolved.error } };

  // BR-37: count-then-create, as in TASK-014.
  const count = await deps.store.countParticipation(resolved.candidateUid);
  if (count >= PARTICIPATION_LIMIT) return { ok: false, result: INVALID };

  return { ok: true, replacement: { teamId, candidateUid: resolved.candidateUid, memberRef: resolved.memberRef } };
}

async function removeInTransaction(
  tx: ConversationTransaction,
  ownerUid: string,
  conversationId: string,
  deps: ChangeParticipantDeps,
  now: Date,
): Promise<ChangeParticipantResult> {
  const raw = await tx.getOwner(ownerUid, conversationId);
  if (raw === undefined) return NOT_FOUND;
  // IMPL-1: removal always reads the payload, so an undecryptable payload fails here, before any write.
  const classification = classifyOwnerDocument(raw, deps.codec);
  if (classification.kind !== "valid") return NOT_FOUND;

  const current = classification.record.participant;
  // Removing a missing participant is a no-op with no write (idempotent).
  if (current === null) return NOOP;

  const encoded = encodeWithoutParticipantNotes(classification.record.content, deps);
  if (!encoded.ok) return FAILED;

  const patch: OwnerDocumentPatch = {
    ...CLEARED_PARTICIPANT_FIELDS,
    updatedAt: new Date(now.getTime()),
    ...encoded.content,
  };
  tx.updateOwner(ownerUid, conversationId, patch);
  tx.deleteParticipation(current.uid, conversationId);
  return OK;
}

async function replaceInTransaction(
  tx: ConversationTransaction,
  ownerUid: string,
  conversationId: string,
  prepared: PreparedReplacement,
  deps: ChangeParticipantDeps,
  now: Date,
): Promise<ChangeParticipantResult> {
  const raw = await tx.getOwner(ownerUid, conversationId);
  if (raw === undefined) return NOT_FOUND;
  const classification = classifyOwnerDocument(raw, deps.codec);
  if (classification.kind !== "valid") return NOT_FOUND;
  const record = classification.record;

  // BR-16: a replacement is allowed only while open. The status is read here, inside the transaction (BR-50 (6)).
  if (record.status === "completed") return COMPLETED;
  // The team is immutable (BR-2), so a mismatch is refused rather than repaired.
  if (record.teamId !== prepared.teamId) return INVALID;

  const current = record.participant;
  // The old participant's notes are deleted with the same re-encryption as a removal (BR-16, IMPL-1). With no current
  // participant there is no content to delete, so the payload is not rewritten.
  let contentPatch: OwnerDocumentPatch = {};
  if (current !== null) {
    const encoded = encodeWithoutParticipantNotes(record.content, deps);
    if (!encoded.ok) return FAILED;
    contentPatch = encoded.content;
  }

  // Every participant field is set here, so the old binding and acceptance are replaced, not merged (BR-16).
  const invitedAt = new Date(now.getTime());
  tx.updateOwner(ownerUid, conversationId, {
    participantUid: prepared.candidateUid,
    participantMemberRef: prepared.memberRef,
    participantState: "pending",
    participantInvitedAt: invitedAt,
    participantAcceptedAt: null,
    updatedAt: new Date(now.getTime()),
    ...contentPatch,
  });
  if (current !== null) tx.deleteParticipation(current.uid, conversationId);
  tx.setParticipation(prepared.candidateUid, conversationId, { ownerUid, invitedAt: new Date(now.getTime()) });
  return OK;
}

export async function changeParticipant(
  ownerUid: string,
  conversationId: string,
  input: unknown,
  deps: ChangeParticipantDeps = defaultDeps(),
): Promise<ChangeParticipantResult> {
  const parsed = parseChangeInput(input);
  if (!parsed.ok) return INPUT_INVALID;

  // A malformed id cannot name a document, so it is refused before any read (D2-SI-15).
  if (!isConversationId(conversationId)) return NOT_FOUND;
  // BR-53: the key probe runs before any document is read or written.
  if (!deps.codec.probeKey().ok) return FAILED;

  try {
    if (parsed.memberRef === null) {
      return await deps.store.runTransaction((tx) => removeInTransaction(tx, ownerUid, conversationId, deps, deps.clock()));
    }

    const prepared = await prepareReplacement(ownerUid, conversationId, parsed.memberRef, deps);
    if (!prepared.ok) return prepared.result;
    const { replacement } = prepared;
    return await deps.store.runTransaction((tx) => replaceInTransaction(tx, ownerUid, conversationId, replacement, deps, deps.clock()));
  } catch {
    // Any read, key or write failure is operational. The raw error is never surfaced (BR-47).
    return FAILED;
  }
}

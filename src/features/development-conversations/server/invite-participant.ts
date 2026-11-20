import "server-only";
import { writeRefusalFor } from "../../auth/server/erasure-write-fence";
import { PARTICIPATION_LIMIT } from "../domain/conversation-constants";
import { isConversationId } from "../domain/conversation-id";
import { probeKey as probeKeyOnce, decryptForClassification as decryptForClassificationWithKey } from "./content-codec";
import { getDefaultConversationStore } from "./conversation-store";
import type { ConversationStore } from "./conversation-store-types";
import { classifyOwnerDocument, type OwnerReadCodec } from "./owner-read";
import {
  boundMemberships,
  confirmBoundColleague,
  createFirestoreSharedTeamReader,
  resolveColleagueRef,
  type SharedTeamReader,
} from "./shared-team-binding";

/**
 * Pending invitation (SPEC BR-7 to BR-11, BR-32, BR-37, BR-48, BR-50 (6), AD-11, CL-2, CL-25, D2-SI-4; TASK-014, A2.1). The
 * owner binds one colleague by `memberRef`. A conversation has no team. The colleague is valid only when the owner and the
 * colleague share an active team in which both are genuine members (`shared-team-binding.ts`).
 *
 * The owner document and the candidate's participation index are written in one transaction. The transaction re-reads the
 * owner document, checks completion and the absence of a participant (BR-10, BR-11), and revalidates the shared team
 * through its own reads (BR-48). Every rejection is `invalid_participant`, except the stable codes for a missing
 * conversation, a completed conversation and an operational failure. The owner uid is the first argument and is never read
 * from the input. The candidate uid is written to server-side fields only, and is never returned.
 */

export interface InviteParticipantDeps {
  store: ConversationStore;
  codec: OwnerReadCodec;
  /** The shared-team seam: point reads of teams and memberships, and the lookup of a membership by its `memberRef`. */
  refReader: SharedTeamReader;
  /** Server time for `participantInvitedAt` and `updatedAt`. Injected so tests can fix it. */
  clock: () => Date;
}

export type InviteParticipantResult =
  | { ok: true }
  | {
      ok: false;
      error: "invalid_participant" | "conversation_completed" | "conversation_not_found" | "erasure_in_progress" | "persistence_failed";
    };

const NOT_FOUND: InviteParticipantResult = { ok: false, error: "conversation_not_found" };
const INVALID: InviteParticipantResult = { ok: false, error: "invalid_participant" };
const COMPLETED: InviteParticipantResult = { ok: false, error: "conversation_completed" };
const FAILED: InviteParticipantResult = { ok: false, error: "persistence_failed" };
const REFUSED: InviteParticipantResult = { ok: false, error: "erasure_in_progress" };

function defaultDeps(): InviteParticipantDeps {
  return {
    store: getDefaultConversationStore(),
    codec: { probeKey: probeKeyOnce, decryptForClassification: decryptForClassificationWithKey },
    refReader: createFirestoreSharedTeamReader(),
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
    const classification = classifyOwnerDocument(before, deps.codec, { ownerUid, conversationId });
    if (classification.kind !== "valid") return NOT_FOUND;

    // A2.1 (BR-9): the colleague must share an active team with the owner. The owner selects no team.
    const resolved = await resolveColleagueRef(ownerUid, memberRef, deps.refReader);
    if (!resolved.ok) return resolved.error === "read_failed" ? FAILED : INVALID;
    const colleague = resolved.colleague;

    // BR-37: count-then-create. A small overshoot under concurrency is accepted, as in D1.
    const count = await deps.store.countParticipation(colleague.uid);
    if (count >= PARTICIPATION_LIMIT) return INVALID;

    const now = deps.clock();
    return await deps.store.runOwnerTransaction(
      ownerUid,
      async (tx): Promise<InviteParticipantResult> => {
        const raw = await tx.getOwner(ownerUid, conversationId);
        if (raw === undefined) return NOT_FOUND;
        const classified = classifyOwnerDocument(raw, deps.codec, { ownerUid, conversationId });
        if (classified.kind !== "valid") return NOT_FOUND;
        const record = classified.record;

        // BR-10: the invitation is allowed only while open. The status is read here, inside the transaction (BR-50 (6)).
        if (record.status === "completed") return COMPLETED;
        // BR-11 and BR-10: a participant, pending or accepted, is replaced only through TASK-018.
        if (record.participant !== null) return INVALID;
        // BR-48: the shared team is revalidated from this transaction's own reads.
        const confirmed = await confirmBoundColleague(ownerUid, colleague, tx.teamEligibility);
        if (!confirmed.ok) return confirmed.error === "read_failed" ? FAILED : INVALID;

        tx.updateOwner(ownerUid, conversationId, {
          participantUid: colleague.uid,
          participantBindings: colleague.bindings,
          participantState: "pending",
          participantInvitedAt: new Date(now.getTime()),
          updatedAt: new Date(now.getTime()),
        });
        // Coordination with membership destruction (TASK-038, I-7): the invitee's membership is touched in this transaction.
        for (const membership of boundMemberships(ownerUid, colleague)) {
          tx.touchMembership(membership.uid, membership.teamId, membership.memberRef);
        }
        tx.setParticipation(colleague.uid, conversationId, { ownerUid, invitedAt: new Date(now.getTime()) });
        return { ok: true };
      },
      { secondFence: colleague.uid },
    );
  } catch (error) {
    // Any read, key or write failure is operational. The raw error is never surfaced (BR-47). A fence refusal is its own code.
    return writeRefusalFor(error) === "erasure_in_progress" ? REFUSED : FAILED;
  }
}

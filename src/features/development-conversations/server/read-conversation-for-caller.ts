import "server-only";
import { isConversationId } from "../domain/conversation-id";
import type { ConversationStore } from "./conversation-store-types";
import { readOwnerConversation, type OwnerConversationDto, type ReadOwnerConversationDeps } from "./read-owner-conversation";
import {
  readParticipantConversation,
  type ParticipantConversationDto,
  type ReadParticipantConversationDeps,
} from "./read-participant-conversation";
import { readPendingInvitation, type PendingInvitationDeps, type PendingInvitationDto } from "./read-pending-invitation";

/**
 * Conversation detail dispatch for the verified caller (SPEC BR-14, BR-21, BR-35; TASK-024). The caller uid is the
 * verified subject and the path supplies only the id.
 *
 * Order: the caller's own owner document, then the accepted participant view (BR-21), then the pending view (BR-14).
 * Ownership is a point read of the caller's own path, so a non-owner never reaches owner content, and the owner read
 * keeps its own key probe. The participant branch denies a pending invitee before any key probe, and the pending branch
 * never probes (BR-53). Every denial in every branch is the same `conversation_not_found`. An operational failure is
 * `persistence_failed` and is never turned into the pending view, because it is not evidence that the invitation is gone.
 *
 * This function makes no authorization decision of its own. Each branch keeps its reviewed checks.
 */

export interface ReadConversationForCallerDeps {
  store: ConversationStore;
  owner: ReadOwnerConversationDeps;
  participant: ReadParticipantConversationDeps;
  pending: PendingInvitationDeps;
}

export type ConversationView =
  | { kind: "owner"; dto: OwnerConversationDto }
  | { kind: "participant"; dto: ParticipantConversationDto }
  | { kind: "pending"; dto: PendingInvitationDto };

export type ReadConversationForCallerResult =
  | { ok: true; view: ConversationView }
  | { ok: false; error: "conversation_not_found" | "persistence_failed" };

const NOT_FOUND: ReadConversationForCallerResult = { ok: false, error: "conversation_not_found" };
const FAILED: ReadConversationForCallerResult = { ok: false, error: "persistence_failed" };

export async function readConversationForCaller(
  callerUid: string,
  conversationId: string,
  deps: ReadConversationForCallerDeps,
): Promise<ReadConversationForCallerResult> {
  // A malformed id cannot name a document, so it is refused before any read (D2-SI-15).
  if (!isConversationId(conversationId)) return NOT_FOUND;

  let ownsDocument: boolean;
  try {
    ownsDocument = (await deps.store.getOwner(callerUid, conversationId)) !== undefined;
  } catch {
    return FAILED;
  }
  if (ownsDocument) {
    const owner = await readOwnerConversation(callerUid, conversationId, deps.owner);
    return owner.ok ? { ok: true, view: { kind: "owner", dto: owner.conversation } } : owner;
  }

  const participant = await readParticipantConversation(callerUid, conversationId, deps.participant);
  if (participant.ok) return { ok: true, view: { kind: "participant", dto: participant.dto } };
  if (participant.error === "persistence_failed") return FAILED;

  const pending = await readPendingInvitation(callerUid, conversationId, deps.pending);
  return pending.ok ? { ok: true, view: { kind: "pending", dto: pending.dto } } : pending;
}

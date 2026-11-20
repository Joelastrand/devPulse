import "server-only";
import { classifyStoredShape } from "../domain/stored-owner-conversation";
import { parseStoredParticipationIndex } from "../domain/stored-participation-index";
import type { ConversationStore } from "./conversation-store-types";
import type { ParticipantStateResolver, SharedBinding } from "./owner-read";
import { authorizeBoundParticipant } from "./shared-team-binding";

const NO_BINDING: SharedBinding = { holds: false };

/**
 * The owner's view of a bound participant (SPEC BR-21, BR-42; TASK-023, A2.1). The owner list and detail show `unavailable`
 * when this check does not hold. It re-derives BR-21 for the bound participant on every call, as a participant read does:
 * the index names this owner, the owner document names this participant in the `pending` or `accepted` state, and the
 * shared-team binding holds (`authorizeBoundParticipant`).
 *
 * Reads go through the request reader in the input, which the owner operation memoizes per request (raw reads only). The
 * decision is made here, for this conversation, every time. It reads no `role`, admin status, name or e-mail, and it decrypts
 * nothing. It returns `{ holds: false }` for every failed condition, so a denial carries no reason. A failed read rejects,
 * which the owner operation reports as `persistence_failed` (BR-47). It never reports a read failure as `unavailable`.
 */
export function createProductionParticipantStateResolver(store: ConversationStore): ParticipantStateResolver {
  return async ({ ownerUid, conversationId, participantUid, teamReader }) => {
    // BR-21 (a): the participant's index entry exists and names this owner.
    const rawIndex = await store.getParticipation(participantUid, conversationId);
    if (rawIndex === undefined) return NO_BINDING;
    const index = parseStoredParticipationIndex(rawIndex);
    if (!index.ok || index.entry.ownerUid !== ownerUid) return NO_BINDING;

    // BR-21 (b) and (c): the owner document parses and names this participant as pending or accepted.
    const rawOwner = await store.getOwner(ownerUid, conversationId);
    if (rawOwner === undefined) return NO_BINDING;
    const shape = classifyStoredShape(rawOwner);
    if (shape.kind !== "valid") return NO_BINDING;
    const { participant } = shape.record;
    if (participant === null || participant.uid !== participantUid) return NO_BINDING;
    if (participant.state !== "accepted" && participant.state !== "pending") return NO_BINDING;

    // BR-21 (d) and (e): a shared active team and the bound membership instance. An operational failure rejects.
    const bound = await authorizeBoundParticipant(ownerUid, participantUid, participant.bindings, teamReader);
    if (!bound.ok) {
      if (bound.error === "read_failed") throw new Error("participant state read failed");
      return NO_BINDING;
    }
    return { holds: true, teamId: bound.teamId };
  };
}

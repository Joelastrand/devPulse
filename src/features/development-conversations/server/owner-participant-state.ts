import "server-only";
import { classifyStoredShape } from "../domain/stored-owner-conversation";
import { parseStoredParticipationIndex } from "../domain/stored-participation-index";
import type { ConversationStore } from "./conversation-store-types";
import { bindingMatches } from "./member-ref-binding";
import type { ParticipantStateResolver } from "./owner-read";
import { readGenuineActiveMembership } from "./team-eligibility";

/**
 * The owner's view of a bound participant (SPEC BR-21, BR-42; TASK-023). The owner list and detail show `unavailable`
 * when this check does not hold. It re-derives BR-21 for the bound participant on every call, as a participant read does:
 * the index names this owner, the owner document names this participant in the input team, the state is `accepted` or
 * `pending`, the team is active, and the current membership's memberRef still equals the stored binding (CL-23).
 *
 * Team and membership reads come from the request reader in the input, which the owner operation memoizes per request (raw
 * reads only). The decision is made here, for this conversation, every time. It reads no `role`, admin status, name or e-mail, and it decrypts nothing. It returns `false` for every failed condition,
 * so a denial carries no reason. A failed read rejects, which the owner operation reports as `persistence_failed`
 * (BR-47). It never reports a read failure as `unavailable`.
 */
export function createProductionParticipantStateResolver(store: ConversationStore): ParticipantStateResolver {
  return async ({ ownerUid, conversationId, teamId, participantUid, teamReader }) => {
    // BR-21 (a): the participant's index entry exists and names this owner.
    const rawIndex = await store.getParticipation(participantUid, conversationId);
    if (rawIndex === undefined) return false;
    const index = parseStoredParticipationIndex(rawIndex);
    if (!index.ok || index.entry.ownerUid !== ownerUid) return false;

    // BR-21 (b) and (c): the owner document parses and names this participant, in this team, as pending or accepted.
    const rawOwner = await store.getOwner(ownerUid, conversationId);
    if (rawOwner === undefined) return false;
    const shape = classifyStoredShape(rawOwner);
    if (shape.kind !== "valid") return false;
    const { participant, teamId: storedTeamId } = shape.record;
    if (participant === null || participant.uid !== participantUid) return false;
    if (participant.state !== "accepted" && participant.state !== "pending") return false;
    if (storedTeamId !== teamId) return false;

    // BR-21 (d) and (e): the active team and a current genuine membership. An operational failure rejects.
    const membership = await readGenuineActiveMembership(participantUid, teamId, teamReader);
    if (!membership.ok) {
      if (membership.error === "read_failed") throw new Error("participant state read failed");
      return false;
    }
    return bindingMatches(participant.memberRef, membership);
  };
}

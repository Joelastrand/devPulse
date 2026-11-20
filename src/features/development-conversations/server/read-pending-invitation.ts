import "server-only";
import { isConversationId } from "../domain/conversation-id";
import { classifyStoredShape } from "../domain/stored-owner-conversation";
import { parseStoredParticipationIndex } from "../domain/stored-participation-index";
import { getDefaultConversationStore } from "./conversation-store";
import { assertUidSegment, type ConversationStore } from "./conversation-store-types";
import { resolveRosterNames, type RosterNameDeps } from "./participant-presentation";
import { authorizeBoundParticipant, createFirestoreSharedTeamReader, type SharedTeamReader } from "./shared-team-binding";

/**
 * Pending view for the invitee (SPEC BR-12, BR-14, BR-21 (c)–(e), BR-41, CL-19, CL-20, D2-SI-3, D2-SI-14; TASK-015, A2.1).
 * The invitee sees only the pending DTO: invitation metadata and the owner's roster-level name. No title, section, goal,
 * date or status is read into the result, and no owner uid, caller uid or memberRef is returned.
 *
 * The pending binding is valid only while the owner and the invitee share an active team in which both hold their current
 * membership (`authorizeBoundParticipant`). A conversation has no team, so the response carries no team name.
 *
 * This path uses plain fields only. It never decrypts, so it does not need the key probe (BR-53). The caller uid is the
 * verified uid passed in, and every lookup is by that uid, never by a request value.
 *
 * Every failure to show the pending DTO returns `conversation_not_found` (BR-14). Only an operational read failure is
 * `persistence_failed`.
 */

export interface PendingInvitationDeps {
  store: ConversationStore;
  teamReader: SharedTeamReader;
  /** Production uses the roster-rule default; tests inject a fake. */
  getNames?: RosterNameDeps["getNames"];
}

export interface PendingInvitationDto {
  conversationId: string;
  state: "pending";
  invitedAt: Date;
  ownerDisplayName: string | null;
}

export type ReadPendingInvitationResult =
  | { ok: true; dto: PendingInvitationDto }
  | { ok: false; error: "conversation_not_found" | "persistence_failed" };

const NOT_FOUND: ReadPendingInvitationResult = { ok: false, error: "conversation_not_found" };
const FAILED: ReadPendingInvitationResult = { ok: false, error: "persistence_failed" };

function isUidSegment(uid: string): boolean {
  try {
    assertUidSegment(uid);
    return true;
  } catch {
    return false;
  }
}

function defaultDeps(): PendingInvitationDeps {
  return {
    store: getDefaultConversationStore(),
    teamReader: createFirestoreSharedTeamReader(),
  };
}

export async function readPendingInvitation(
  callerUid: string,
  conversationId: string,
  deps: PendingInvitationDeps = defaultDeps(),
): Promise<ReadPendingInvitationResult> {
  // A malformed id cannot name a document, so it is refused before any read (D2-SI-15).
  if (!isConversationId(conversationId)) return NOT_FOUND;

  try {
    // BR-21 (a): the caller's index entry must exist and name a valid owner.
    const rawIndex = await deps.store.getParticipation(callerUid, conversationId);
    if (rawIndex === undefined) return NOT_FOUND;
    const index = parseStoredParticipationIndex(rawIndex);
    if (!index.ok || !isUidSegment(index.entry.ownerUid)) return NOT_FOUND;
    const ownerUid = index.entry.ownerUid;

    // BR-21 (b): the owner document must exist and have a valid plain shape. The payload is not decrypted here.
    const rawOwner = await deps.store.getOwner(ownerUid, conversationId);
    if (rawOwner === undefined) return NOT_FOUND;
    const classification = classifyStoredShape(rawOwner);
    if (classification.kind !== "valid") return NOT_FOUND;
    const participant = classification.record.participant;

    // BR-21 (c), pending branch: the document must name this caller as a pending participant.
    if (participant === null || participant.uid !== callerUid || participant.state !== "pending") return NOT_FOUND;

    // BR-21 (d) and (e): a shared active team and the bound membership instance.
    const binding = await authorizeBoundParticipant(ownerUid, callerUid, participant.bindings, deps.teamReader);
    if (!binding.ok) return binding.error === "read_failed" ? FAILED : NOT_FOUND;

    // BR-41: the owner's name, under the roster rule. It is null unless both parties hold an active membership.
    const request = { viewerUid: callerUid, teamId: binding.teamId, subjectUid: ownerUid };
    const names = await resolveRosterNames([request], { teamReader: deps.teamReader, getNames: deps.getNames });
    if (!names.ok) return FAILED;

    return {
      ok: true,
      dto: {
        conversationId,
        state: "pending",
        invitedAt: new Date(index.entry.invitedAt.getTime()),
        ownerDisplayName: names.displayNameOf(request),
      },
    };
  } catch {
    // Any read failure is operational. The raw error is never surfaced (BR-47).
    return FAILED;
  }
}

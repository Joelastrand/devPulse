import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { isPlainObject, isNonEmptyString } from "../domain/stored-shape";
import { isConversationId } from "../domain/conversation-id";
import { classifyStoredShape } from "../domain/stored-owner-conversation";
import { parseStoredParticipationIndex } from "../domain/stored-participation-index";
import { getDefaultConversationStore } from "./conversation-store";
import { assertUidSegment, type ConversationStore } from "./conversation-store-types";
import { resolveRosterNames, type RosterNameDeps } from "./participant-presentation";
import { bindingMatches } from "./member-ref-binding";
import { createFirestoreTeamEligibilityReader, readGenuineActiveMembership, type TeamEligibilityReader } from "./team-eligibility";

/**
 * Pending view for the invitee (SPEC BR-12, BR-14, BR-21 (c)–(e), BR-41, CL-19, CL-20, D2-SI-3, D2-SI-14; TASK-015).
 * The invitee sees only the pending DTO: invitation metadata, the team name and the owner's roster-level name. No title,
 * section, goal, date or status is read into the result, and no owner uid, caller uid or memberRef is returned.
 *
 * This path uses plain fields only. It never decrypts, so it does not need the key probe (BR-53): an invitee can see the
 * pending DTO while the content is unreadable, and no content can be reached through it. The caller uid is the verified
 * uid passed in, and every lookup is by that uid, never by a request value.
 *
 * Every failure to show the pending DTO returns `conversation_not_found` (BR-14). Only an operational read failure is
 * `persistence_failed`. The team name read is isolated behind `TeamNameReader`, because no other D2 module reads it.
 */

/** The one team read this module needs beyond the TASK-006 reads: the display name of `teams/{teamId}`. */
export interface TeamNameReader {
  /** Raw `name` field of `teams/{teamId}`, or any non-string value when absent. Unvalidated. */
  getTeamName(teamId: string): Promise<unknown>;
}

export interface PendingInvitationDeps {
  store: ConversationStore;
  teamReader: TeamEligibilityReader;
  teamNameReader: TeamNameReader;
  /** Production uses the roster-rule default; tests inject a fake. */
  getNames?: RosterNameDeps["getNames"];
}

export interface PendingInvitationDto {
  conversationId: string;
  state: "pending";
  teamName: string;
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

/** Production team name read. Only the `name` field is taken from the team document. */
export function createFirestoreTeamNameReader(): TeamNameReader {
  return {
    async getTeamName(teamId) {
      const snapshot = await getFirestoreDb().collection("teams").doc(teamId).get();
      const data: unknown = snapshot.data();
      return isPlainObject(data) ? data.name : undefined;
    },
  };
}

function defaultDeps(): PendingInvitationDeps {
  return {
    store: getDefaultConversationStore(),
    teamReader: createFirestoreTeamEligibilityReader(),
    teamNameReader: createFirestoreTeamNameReader(),
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
    const record = classification.record;

    // BR-21 (c), pending branch: the document must name this caller as a pending participant.
    const participant = record.participant;
    if (participant === null || participant.uid !== callerUid || participant.state !== "pending") return NOT_FOUND;
    // A participant exists only when a team is linked (BR-2, BR-3).
    const teamId = record.teamId;
    if (teamId === null) return NOT_FOUND;

    // BR-21 (d) and (e): active team, a current genuine membership, and the bound memberRef still equal.
    const membership = await readGenuineActiveMembership(callerUid, teamId, deps.teamReader);
    if (!membership.ok) return membership.error === "read_failed" ? FAILED : NOT_FOUND;
    if (!bindingMatches(participant.memberRef, membership)) return NOT_FOUND;

    const rawTeamName = await deps.teamNameReader.getTeamName(teamId);
    if (!isNonEmptyString(rawTeamName)) return FAILED;

    // BR-41: the owner's name, under the roster rule. It is null unless both parties hold an active membership.
    const request = { viewerUid: callerUid, teamId, subjectUid: ownerUid };
    const names = await resolveRosterNames([request], { teamReader: deps.teamReader, getNames: deps.getNames });
    if (!names.ok) return FAILED;

    return {
      ok: true,
      dto: {
        conversationId,
        state: "pending",
        teamName: rawTeamName,
        invitedAt: new Date(index.entry.invitedAt.getTime()),
        ownerDisplayName: names.displayNameOf(request),
      },
    };
  } catch {
    // Any read failure is operational. The raw error is never surfaced (BR-47).
    return FAILED;
  }
}

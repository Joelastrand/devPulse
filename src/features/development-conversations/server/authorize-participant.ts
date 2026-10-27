import "server-only";
import { isNonEmptyString } from "../domain/stored-shape";
import { classifyStoredShape } from "../domain/stored-owner-conversation";
import { parseStoredParticipationIndex } from "../domain/stored-participation-index";
import { assertUidSegment } from "./conversation-store-types";
import { bindingMatches } from "./member-ref-binding";
import type { GenuineMembershipResult } from "./team-eligibility";

/**
 * The single participant access decision for content (SPEC BR-21, D2-SI-2, D2-SI-14; TASK-017). It is pure: it reads
 * nothing and performs no I/O. The caller fetches the raw index, the raw owner document and the TASK-006 membership
 * result, then asks this function whether the verified caller may read content.
 *
 * `membership` is `readGenuineActiveMembership` for the owner document's team. It already encodes BR-21 (d), the active
 * team, and (e), a genuine current membership. A `read_failed` result is handled by the caller as an operational failure
 * before this decision is reached, so it is never allowed and never reaches here as an allow.
 *
 * Denial carries no reason, so every failing condition is indistinguishable to the caller (BR-21, D2-SI-15).
 */

export interface ParticipantAccessMaterial {
  /** The verified uid of the caller. Every check is against this value, never against a request value. */
  callerUid: string;
  /** The raw participant index entry at the caller's path, or `undefined` when absent. */
  index: unknown;
  /** The raw owner document at the index's owner path, or `undefined` when absent. Read as plain fields only. */
  owner: unknown;
  /** The TASK-006 result for the caller in the owner document's team. Role and admin status are never read. */
  membership: GenuineMembershipResult;
}

export type ParticipantAccessDecision =
  | { allowed: true; ownerUid: string; teamId: string }
  | { allowed: false };

const DENIED: ParticipantAccessDecision = { allowed: false };

function isUidSegment(uid: string): boolean {
  try {
    assertUidSegment(uid);
    return true;
  } catch {
    return false;
  }
}

/** BR-21 (a): the owner uid named by a valid index entry, or `null` when the entry is absent, malformed or unusable. */
export function participantOwnerUid(rawIndex: unknown): string | null {
  const index = parseStoredParticipationIndex(rawIndex);
  return index.ok && isUidSegment(index.entry.ownerUid) ? index.entry.ownerUid : null;
}

export function authorizeParticipant(material: ParticipantAccessMaterial): ParticipantAccessDecision {
  // (a) The caller's index entry must exist and name a usable owner uid.
  const ownerUid = participantOwnerUid(material.index);
  if (ownerUid === null) return DENIED;

  // (b) The owner document must parse as valid plain shape. Its content is not decrypted here.
  const shape = classifyStoredShape(material.owner);
  if (shape.kind !== "valid") return DENIED;
  const record = shape.record;

  // (c) It must name this caller as an accepted participant. A participant exists only with a linked team (BR-2, BR-3).
  const participant = record.participant;
  if (participant === null || participant.uid !== material.callerUid || participant.state !== "accepted") return DENIED;
  if (record.teamId === null || !isNonEmptyString(record.teamId)) return DENIED;

  // (d) and (e): the active team and a current genuine membership, both inside the TASK-006 result.
  if (!material.membership.ok) return DENIED;

  // (e) The bound memberRef must still equal the current membership's memberRef (BR-21(e), CL-23). Rejoin is a mismatch.
  if (!bindingMatches(participant.memberRef, material.membership)) return DENIED;

  return { allowed: true, ownerUid, teamId: record.teamId };
}

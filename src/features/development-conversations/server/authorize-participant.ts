import "server-only";
import { classifyStoredShape } from "../domain/stored-owner-conversation";
import { parseStoredParticipationIndex } from "../domain/stored-participation-index";
import { assertUidSegment } from "./conversation-store-types";
import type { BoundParticipantResult } from "./shared-team-binding";

/**
 * The single participant access decision for content (SPEC BR-21, D2-SI-2, D2-SI-14; TASK-017, A2.1). It is pure: it reads
 * nothing and performs no I/O. The caller fetches the raw index and the raw owner document, then asks this function whether
 * the verified caller may read content. The caller also runs `authorizeBoundParticipant`, which carries the shared-team and
 * membership-instance checks (BR-21 (d) and (e)).
 *
 * A conversation has no team (A2.1). The shared team comes only from `binding`, never from the owner document.
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
  /** The shared-team binding check for the caller, from `authorizeBoundParticipant`. */
  binding: BoundParticipantResult;
}

export type ParticipantAccessDecision = { allowed: true; ownerUid: string; teamId: string } | { allowed: false };

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
  const participant = shape.record.participant;

  // (c) It must name this caller as an accepted participant. Pending invitations are not content access (BR-21).
  if (participant === null || participant.uid !== material.callerUid || participant.state !== "accepted") return DENIED;

  // (d) and (e): a shared active team and the bound membership instance, both inside the binding result.
  if (!material.binding.ok) return DENIED;

  return { allowed: true, ownerUid, teamId: material.binding.teamId };
}

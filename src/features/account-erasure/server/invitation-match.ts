import { invitationEmailIndex } from "../../teams/domain/team-invitation-content-codec";

/**
 * Whether a stored invitation belongs to the erased person (I-11).
 *
 * The stored address is sealed, so ownership is decided by the blind index `emailIndex` (see
 * `teams/domain/team-invitation-content-codec.ts`), never by a plaintext email or a document-id suffix.
 *
 * - A stored `emailIndex` that equals the index of the erased address matches.
 * - A stored `emailIndex` that is missing, blank or not a string (a malformed record, AE-SI-7) is attributed only by the exact
 *   deterministic id `${teamId}__${index}`. A malformed value never makes an exactly attributable invitation survive.
 * - A record resolved by this uid (`resolvedUid`) matches.
 *
 * The step, the adapter and the residual counter all use this one rule. No uid or address is added to any stored value.
 */
export function invitationBelongsToErasedPerson(
  id: string,
  record: Readonly<Record<string, unknown>>,
  normalizedEmail: string,
  uid: string,
): boolean {
  const expectedIndex = invitationEmailIndex(normalizedEmail);
  const stored = typeof record.emailIndex === "string" ? record.emailIndex : "";
  if (stored.length > 0) {
    if (stored === expectedIndex) return true;
  } else if (typeof record.teamId === "string") {
    if (id === `${record.teamId}__${expectedIndex}`) return true;
  }
  return record.resolvedUid === uid;
}

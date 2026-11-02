import { normalizeEmail } from "../../teams/domain/normalize-email";

/**
 * Whether a stored invitation belongs to the erased person (I-11, TASK-038 finding 2, 2026-11-02).
 *
 * - A stored `email` that is a string and normalizes to the erased address matches.
 * - A stored `email` that is a string but different never matches by its document id. An id can contain `__` inside an
 *   address, so a suffix is never trusted for a valid stored address.
 * - A stored `email` that is missing, blank, null, or any other non-string value (a malformed record, AE-SI-7) cannot be normalized,
 *   so it is attributed only by the exact deterministic id `${teamId}__${normalizedEmail}`. A malformed value never makes an
 *   otherwise exactly attributable invitation survive, and it never widens to a suffix match.
 * - A record resolved by this uid (`resolvedUid`) matches.
 *
 * Pure. The step, the adapter's candidate filter and the residual counter all use this one rule. No uid or e-mail is added to
 * any stored value; the rule reads the existing identity contract only.
 */
export function invitationBelongsToErasedPerson(
  id: string,
  record: Readonly<Record<string, unknown>>,
  normalizedEmail: string,
  uid: string,
): boolean {
  // A usable stored address is a string that normalizes to something non-empty. Anything else is malformed and uses the exact id.
  const stored = typeof record.email === "string" ? normalizeEmail(record.email) : "";
  if (stored.length > 0) {
    if (stored === normalizedEmail) return true;
  } else if (typeof record.teamId === "string") {
    if (id === `${record.teamId}__${normalizedEmail}`) return true;
  }
  return record.resolvedUid === uid;
}

export type MembershipSource = "invitation" | "access_request" | "admin_direct";

/**
 * A Firestore `teamMemberships` document (docs/features/team-management/
 * SPEC.md — Architecture decisions → "Firestore collections"). Links one
 * Firebase `uid` to one `teamId` — never email-keyed.
 */
export interface TeamMembershipRecord {
  uid: string;
  teamId: string;
  createdAt: Date;
  createdVia: MembershipSource;
  grantedBy: string;
}

/**
 * Builds the deterministic `teamMemberships` document id for one (uid,
 * teamId) pair. Used only as a uniqueness/lookup key when writing or
 * fetching a specific membership — never parsed back apart to recover
 * `uid`/`teamId` from an arbitrary id string.
 */
export function membershipDocId(uid: string, teamId: string): string {
  return `${uid}__${teamId}`;
}

/**
 * Validates that a raw Firestore document plausibly represents a
 * membership grant for the exact (uid, teamId) pair being authorized —
 * the minimum fields an authorization decision needs. This is the
 * fail-closed check at the authorization boundary
 * (`authorize-team-access.ts`): returns `false` (never throws, never
 * assumes via an unchecked cast) for a missing document, a document
 * belonging to a different uid/teamId, or any other malformed shape, so
 * a corrupt or unexpectedly-shaped document can never be mistaken for a
 * valid grant.
 */
export function isValidMembershipFor(
  data: unknown,
  expected: { uid: string; teamId: string },
): boolean {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const record = data as Record<string, unknown>;
  return record.uid === expected.uid && record.teamId === expected.teamId;
}

/**
 * Extracts a well-formed `uid` from a raw `teamMemberships` document for
 * member-list display (BR-29). Returns `null` (excluded from the list,
 * never fabricated or thrown) for a document with a missing, non-string,
 * or empty `uid` field.
 */
export function extractMemberUid(data: unknown): string | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const record = data as Record<string, unknown>;
  return typeof record.uid === "string" && record.uid.length > 0
    ? record.uid
    : null;
}

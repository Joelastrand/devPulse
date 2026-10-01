export type MembershipSource = "invitation" | "access_request" | "admin_direct";

/**
 * The team authorization role a membership carries: `"lead"` or an ordinary
 * `"member"` (docs/features/member-identity-and-team-roles/SPEC.md — BR-16).
 * Only `"lead"` is ever persisted (as `role`); `"member"` is represented by
 * the field being absent. This is a *team role*, never a professional role.
 */
export type MembershipRole = "lead" | "member";

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
  /** Present only while the member is a team lead; absent ≡ ordinary member. */
  role?: "lead";
  /** Paired with `roleUpdatedBy`: the last role assignment/removal (audit only, never consulted for authorization). */
  roleUpdatedAt?: Date;
  roleUpdatedBy?: string;
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

/**
 * Classifies a raw `teamMemberships` document's team role (SPEC — BR-17).
 * Fail-safe toward least privilege: `"lead"` only when `role === "lead"`
 * exactly; a missing field (every pre-existing document), any other value,
 * or non-object input is an ordinary `"member"`. Pure domain
 * classification — it neither validates the membership (use
 * `isValidMembershipFor`) nor authorizes anything.
 */
export function membershipRoleOf(data: unknown): MembershipRole {
  if (typeof data !== "object" || data === null) {
    return "member";
  }

  return (data as Record<string, unknown>).role === "lead" ? "lead" : "member";
}

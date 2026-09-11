export type InvitationStatus = "pending" | "accepted" | "canceled";

const INVITATION_STATUSES: readonly InvitationStatus[] = ["pending", "accepted", "canceled"];

export function isValidInvitationStatus(value: unknown): value is InvitationStatus {
  return (
    typeof value === "string" &&
    (INVITATION_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * A Firestore `teamInvitations` document (docs/features/team-management/
 * SPEC.md — Architecture decisions → "Firestore collections"). `email` is
 * always normalized (trim + lowercase) before storage — used only for
 * matching a future verified sign-in, never copied into `teamMemberships`.
 */
export interface TeamInvitationRecord {
  teamId: string;
  email: string;
  status: InvitationStatus;
  invitedBy: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
  resolvedUid?: string;
}

/**
 * Builds the deterministic `teamInvitations` document id for one (teamId,
 * normalizedEmail) pair — the identity this feature uses to prevent
 * duplicate active invitations (BR-19) and to resolve a pending invitation
 * (BR-20). Used only as a uniqueness/lookup key, never parsed back apart.
 */
export function invitationDocId(teamId: string, normalizedEmail: string): string {
  return `${teamId}__${normalizedEmail}`;
}

/**
 * Validates that a raw Firestore document is a currently-pending
 * invitation for exactly the expected (teamId, email) pair — the
 * fail-closed check used before resolving an invitation into membership
 * (`resolve-invitations.ts`) or before treating one as already pending
 * (`create-invitation.ts`, BR-19). Returns `false` (never throws, never
 * assumes via an unchecked cast) for a missing document, a document
 * belonging to a different team/email, a non-pending status, or any other
 * malformed shape.
 */
export function isValidPendingInvitationFor(
  data: unknown,
  expected: { teamId: string; email: string },
): data is TeamInvitationRecord {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const record = data as Record<string, unknown>;
  return (
    record.teamId === expected.teamId &&
    record.email === expected.email &&
    record.status === "pending" &&
    typeof record.invitedBy === "string" &&
    record.invitedBy.length > 0
  );
}

/**
 * Reads the validated status of a raw invitation document for exactly the
 * expected (teamId, email) pair, without requiring it to be `"pending"` —
 * used by `create-invitation.ts` to decide whether re-inviting is a no-op
 * (an existing `"pending"` record, BR-19) or should create a fresh pending
 * record (no record, or one that is `"accepted"`/`"canceled"`). Returns
 * `null` (fail closed) for a missing document, a document belonging to a
 * different team/email, or a malformed/unrecognized `status`.
 */
export function readInvitationStatusFor(
  data: unknown,
  expected: { teamId: string; email: string },
): InvitationStatus | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const record = data as Record<string, unknown>;
  if (record.teamId !== expected.teamId || record.email !== expected.email) {
    return null;
  }

  return isValidInvitationStatus(record.status) ? record.status : null;
}

/**
 * Validates a raw invitation document as a well-formed, currently-pending
 * invitation belonging to the given `teamId` — used by
 * `list-team-invitations.ts` (BR-30) to build an admin's pending-invitation
 * view without trusting an unchecked cast. A malformed document is excluded
 * from the list rather than causing the whole list to fail.
 */
export function isValidPendingInvitationForTeam(
  data: unknown,
  teamId: string,
): data is TeamInvitationRecord {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const record = data as Record<string, unknown>;
  return (
    record.teamId === teamId &&
    typeof record.email === "string" &&
    record.email.length > 0 &&
    record.status === "pending" &&
    typeof record.invitedBy === "string" &&
    record.invitedBy.length > 0
  );
}

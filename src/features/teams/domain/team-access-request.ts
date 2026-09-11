export type AccessRequestStatus = "pending" | "approved" | "rejected";

const ACCESS_REQUEST_STATUSES: readonly AccessRequestStatus[] = [
  "pending",
  "approved",
  "rejected",
];

export function isValidAccessRequestStatus(value: unknown): value is AccessRequestStatus {
  return (
    typeof value === "string" &&
    (ACCESS_REQUEST_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * A Firestore `teamAccessRequests` document (docs/features/team-management/
 * SPEC.md — Architecture decisions → "Firestore collections"). Deliberately
 * no persisted email — `uid`-keyed like `teamMemberships`; the requester's
 * email (for admin display only) is resolved on demand from Firebase Auth,
 * never stored here.
 */
export interface TeamAccessRequestRecord {
  teamId: string;
  uid: string;
  status: AccessRequestStatus;
  createdAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
}

/**
 * Builds the deterministic `teamAccessRequests` document id for one (uid,
 * teamId) pair — the identity this feature uses to prevent duplicate
 * active requests (BR-24) and to atomically approve/reject (BR-27). Used
 * only as a uniqueness/lookup key, never parsed back apart.
 */
export function accessRequestDocId(uid: string, teamId: string): string {
  return `${uid}__${teamId}`;
}

/**
 * Validates that a raw Firestore document is a currently-pending access
 * request for exactly the expected (uid, teamId) pair — the fail-closed
 * check used before treating a request as active (BR-24) or eligible for
 * approval/rejection. Returns `false` (never throws, never assumes via an
 * unchecked cast) for a missing document, a document belonging to a
 * different uid/team, a non-pending status, or any other malformed shape.
 */
export function isValidPendingAccessRequestFor(
  data: unknown,
  expected: { uid: string; teamId: string },
): data is TeamAccessRequestRecord {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const record = data as Record<string, unknown>;
  return (
    record.teamId === expected.teamId &&
    record.uid === expected.uid &&
    record.status === "pending"
  );
}

/**
 * Reads the validated status of a raw access-request document for exactly
 * the expected (uid, teamId) pair, without requiring it to be `"pending"` —
 * used to decide whether a request is eligible for approval/rejection or
 * whether re-requesting should reset it to pending (BR-25). Returns `null`
 * (fail closed) for a missing document, a document belonging to a
 * different uid/team, or a malformed/unrecognized `status`.
 */
export function readAccessRequestStatusFor(
  data: unknown,
  expected: { uid: string; teamId: string },
): AccessRequestStatus | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const record = data as Record<string, unknown>;
  if (record.teamId !== expected.teamId || record.uid !== expected.uid) {
    return null;
  }

  return isValidAccessRequestStatus(record.status) ? record.status : null;
}

/**
 * Validates a raw access-request document as a well-formed, currently-
 * pending request belonging to the given `teamId` — used by
 * `list-team-access-requests.ts` (BR-30) to build an admin's pending-
 * request view without trusting an unchecked cast. A malformed document
 * is excluded from the list rather than causing the whole list to fail.
 */
export function isValidPendingAccessRequestForTeam(
  data: unknown,
  teamId: string,
): data is TeamAccessRequestRecord {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const record = data as Record<string, unknown>;
  return (
    record.teamId === teamId &&
    typeof record.uid === "string" &&
    record.uid.length > 0 &&
    record.status === "pending"
  );
}

import "server-only";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { memberRefOf } from "../../teams/domain/member-ref";
import { isValidTeamStatus } from "../../teams/domain/team";
import { isValidMembershipFor, membershipDocId } from "../../teams/domain/team-membership";

const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";

/**
 * The raw team reads this seam depends on. Returns unvalidated field and document data; the seam validates it before
 * trusting it. Production reads Firestore; tests use the in-memory fake.
 */
export interface TeamEligibilityReader {
  /** Raw `status` field of `teams/{teamId}`, or `undefined` if no such document exists. */
  getTeamStatus(teamId: string): Promise<unknown>;
  /** Raw `teamMemberships/{uid}__{teamId}` document data, or `undefined` if it does not exist. */
  getMembership(uid: string, teamId: string): Promise<unknown>;
}

export type TeamEligibilityError = "not_eligible" | "read_failed";

/**
 * One raw `teamMemberships` document from a query: its document id and its unvalidated data. The id is kept so the
 * caller can require `{uid}__{teamId}` to match the data it reads.
 */
export interface RawOwnMembership {
  id: string;
  data: unknown;
}

/**
 * The bounded reads the create-options list needs (SPEC create-options contract). Production uses Firestore; tests use
 * the in-memory fake. Returns raw, unvalidated data. The operation validates it before trusting any of it.
 */
export interface TeamChoiceReader {
  /** At most `limit` raw `teamMemberships` documents whose `uid` is `uid`. No ordering is assumed. */
  listOwnMemberships(uid: string, limit: number): Promise<RawOwnMembership[]>;
  /** Raw data of `teams/{teamId}` for each id, in input order. `undefined` for a missing document. */
  getTeams(teamIds: readonly string[]): Promise<unknown[]>;
}

/** A team id is one document-path segment: non-empty, no `/`, not `.` or `..`, and not of the reserved `__…__` form. */
export function isTeamIdSegment(value: string): boolean {
  return value.length > 0 && !value.includes("/") && value !== "." && value !== ".." && !/^__.*__$/.test(value);
}

/** The team status rule shared by create and create-options: exactly `"active"`. Any other value is not active. */
export function isActiveTeamStatus(value: unknown): boolean {
  return isValidTeamStatus(value) && value === "active";
}

/**
 * `memberRef` is returned for TASK-007 to consume. It is never authorization on its own, and callers must not expose
 * it.
 */
export type GenuineMembershipResult = { ok: true; memberRef: string | null } | { ok: false; error: TeamEligibilityError };

/**
 * Decides, from the team and membership documents alone, whether `uid` is a genuine, current, active member of
 * `teamId`. The membership `role` and app-admin status are never consulted. A failed read is reported as
 * `read_failed` and is never collapsed into `not_eligible`.
 */
export async function readGenuineActiveMembership(
  uid: string,
  teamId: string,
  reader: TeamEligibilityReader,
): Promise<GenuineMembershipResult> {
  let rawStatus: unknown;
  try {
    rawStatus = await reader.getTeamStatus(teamId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  if (!isActiveTeamStatus(rawStatus)) {
    return { ok: false, error: "not_eligible" };
  }

  let rawMembership: unknown;
  try {
    rawMembership = await reader.getMembership(uid, teamId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  if (!isValidMembershipFor(rawMembership, { uid, teamId })) {
    return { ok: false, error: "not_eligible" };
  }

  return { ok: true, memberRef: memberRefOf(rawMembership) };
}

/**
 * Owner check at creation and at each invitation or replacement (BR-2, BR-9, BR-10). Uses the same read as
 * `readGenuineActiveMembership`, without returning the member reference.
 */
export async function ownerCanInvite(
  ownerUid: string,
  teamId: string,
  reader: TeamEligibilityReader,
): Promise<{ ok: true } | { ok: false; error: TeamEligibilityError }> {
  const result = await readGenuineActiveMembership(ownerUid, teamId, reader);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/** The production reader: two exact document reads through the centralized Admin SDK initialization. */
export function createFirestoreTeamEligibilityReader(): TeamEligibilityReader {
  return {
    async getTeamStatus(teamId) {
      const snapshot = await teamDocument(getFirestoreDb(), teamId).get();
      return snapshot.exists ? snapshot.data()?.status : undefined;
    },
    async getMembership(uid, teamId) {
      const snapshot = await membershipDocument(getFirestoreDb(), uid, teamId).get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
  };
}

/**
 * The production create-options reader: one equality query on the caller's own `uid` with an explicit limit, and one
 * batch of team point reads for the ids the window produced. Both are bounded by the caller of this function.
 */
export function createFirestoreTeamChoiceReader(): TeamChoiceReader {
  return {
    async listOwnMemberships(uid, limit) {
      const snapshot = await getFirestoreDb().collection(MEMBERSHIPS_COLLECTION).where("uid", "==", uid).limit(limit).get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
    async getTeams(teamIds) {
      if (teamIds.length === 0) return [];
      const db = getFirestoreDb();
      const snapshots = await db.getAll(...teamIds.map((teamId) => teamDocument(db, teamId)));
      return snapshots.map((snapshot) => (snapshot.exists ? snapshot.data() : undefined));
    },
  };
}

/**
 * The same two exact reads, performed inside `tx` (BR-48, TASK-019). A participant write authorizes its commit from these
 * reads only, so the team and the membership are re-read on every transaction attempt. The decision stays in
 * `readGenuineActiveMembership`; this reader returns raw data and nothing else.
 */
export function createTransactionTeamEligibilityReader(db: Firestore, tx: Transaction): TeamEligibilityReader {
  return {
    async getTeamStatus(teamId) {
      const snapshot = await tx.get(teamDocument(db, teamId));
      return snapshot.exists ? snapshot.data()?.status : undefined;
    },
    async getMembership(uid, teamId) {
      const snapshot = await tx.get(membershipDocument(db, uid, teamId));
      return snapshot.exists ? snapshot.data() : undefined;
    },
  };
}

function teamDocument(db: Firestore, teamId: string) {
  return db.collection(TEAMS_COLLECTION).doc(teamId);
}

function membershipDocument(db: Firestore, uid: string, teamId: string) {
  return db.collection(MEMBERSHIPS_COLLECTION).doc(membershipDocId(uid, teamId));
}

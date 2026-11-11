import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { runFencedTransaction } from "../../auth/server/erasure-write-fence";

/**
 * Server-only persistence for formal role assignments at `roleAssignments/{uid}` (role-profiles SPEC, "Formal role
 * assignment"). Admin SDK only: client access is denied by `firestore.rules`. Writes are fenced on the TARGET uid, so an
 * erasure in progress for that person refuses any change to the assignment (AE fence, BR-4(b)).
 */

const ASSIGNMENTS_COLLECTION = "roleAssignments";

export interface RawAssignmentData {
  [key: string]: unknown;
}

export interface RoleAssignmentWriteStore {
  /** Raw stored data for one uid, or `undefined` when absent. Read failures reject and are never absence. */
  get(uid: string): Promise<RawAssignmentData | undefined>;
  /** Raw stored data for each uid in `uids`, in the same order. Missing entries are `undefined`. */
  getMany(uids: readonly string[]): Promise<Array<RawAssignmentData | undefined>>;
  /**
   * Creates or replaces the assignment for `uid` in one fenced transaction. A new document records `createdAt`/`createdBy`;
   * a change keeps them and records `updatedAt`/`updatedBy`. Returns whether the document was created.
   */
  assign(uid: string, roleId: string, actorUid: string, now: Date): Promise<{ created: boolean }>;
  /** Removes the assignment for `uid` in one fenced transaction. Returns whether a document existed. */
  remove(uid: string): Promise<{ removed: boolean }>;
}

function assignmentsCollection() {
  return getFirestoreDb().collection(ASSIGNMENTS_COLLECTION);
}

function assignmentRef(uid: string) {
  return assignmentsCollection().doc(uid);
}

function toRaw(data: Record<string, unknown>): RawAssignmentData {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, value instanceof Timestamp ? value.toDate() : value]),
  );
}

export function getDefaultRoleAssignmentStore(): RoleAssignmentWriteStore {
  return {
    async get(uid) {
      const snapshot = await assignmentRef(uid).get();
      return snapshot.exists ? toRaw(snapshot.data() ?? {}) : undefined;
    },

    async getMany(uids) {
      if (uids.length === 0) return [];
      const db = getFirestoreDb();
      const snapshots = await db.getAll(...uids.map((uid) => assignmentRef(uid)));
      return snapshots.map((snapshot) => (snapshot.exists ? toRaw(snapshot.data() ?? {}) : undefined));
    },

    async assign(uid, roleId, actorUid, now) {
      const db = getFirestoreDb();
      return runFencedTransaction(db, uid, async (tx) => {
        const ref = assignmentRef(uid);
        const existing = await tx.get(ref);
        if (!existing.exists) {
          tx.create(ref, {
            roleId,
            createdAt: Timestamp.fromDate(now),
            createdBy: actorUid,
          });
          return { created: true };
        }
        tx.update(ref, {
          roleId,
          updatedAt: Timestamp.fromDate(now),
          updatedBy: actorUid,
        });
        return { created: false };
      });
    },

    async remove(uid) {
      const db = getFirestoreDb();
      return runFencedTransaction(db, uid, async (tx) => {
        const ref = assignmentRef(uid);
        const existing = await tx.get(ref);
        if (!existing.exists) return { removed: false };
        tx.delete(ref);
        return { removed: true };
      });
    },
  };
}

import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";

const USER_PROFILES_COLLECTION = "userProfiles";

/**
 * The persistence seam for `userProfiles/{uid}` — satisfied in production by
 * Firestore (Admin SDK, server-only) and by an in-memory fake in tests.
 * Every method is keyed by the caller's own verified `uid`; there is no
 * lookup by name or any other field, and no list operation.
 */
export interface UserProfileStore {
  /** Raw document data (Timestamps mapped to `Date`), or `undefined` when absent. Unvalidated. */
  read(uid: string): Promise<unknown>;
  /**
   * Atomically replaces the whole document with `build(existing)`, where
   * `existing` is the raw, unvalidated current data (or `undefined`).
   * A full replace (not a merge) keeps the document to its minimal shape.
   */
  upsert(uid: string, build: (existing: unknown) => Record<string, unknown>): Promise<void>;
  /** Hard-deletes the document; succeeds if it does not exist. */
  remove(uid: string): Promise<void>;
}

/** Maps raw Firestore data (Timestamp fields included) into the `Date`-based candidate shape `isValidUserProfile` expects. */
export function toProfileCandidate(data: unknown): unknown {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  return {
    ...record,
    createdAt: toDate(record.createdAt),
    updatedAt: toDate(record.updatedAt),
  };
}

function toDate(value: unknown): unknown {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "object" && value !== null && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate();
  }
  // Left as-is so the validator fails closed on an unexpected shape.
  return value;
}

export function getDefaultUserProfileStore(): UserProfileStore {
  return {
    async read(uid) {
      const snapshot = await getFirestoreDb().collection(USER_PROFILES_COLLECTION).doc(uid).get();
      return snapshot.exists ? toProfileCandidate(snapshot.data()) : undefined;
    },
    async upsert(uid, build) {
      const db = getFirestoreDb();
      const ref = db.collection(USER_PROFILES_COLLECTION).doc(uid);
      await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        tx.set(ref, build(snapshot.exists ? toProfileCandidate(snapshot.data()) : undefined));
      });
    },
    async remove(uid) {
      await getFirestoreDb().collection(USER_PROFILES_COLLECTION).doc(uid).delete();
    },
  };
}

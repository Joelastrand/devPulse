import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { isValidUserProfile } from "../domain/user-profile";
import { toProfileCandidate } from "./user-profile-store";

const USER_PROFILES_COLLECTION = "userProfiles";

/** Maximum document refs per Firestore `getAll` call (docs/features/member-identity-and-team-roles/SPEC.md — BR-13). */
export const DISPLAY_NAME_BATCH_SIZE = 100;

/**
 * The batched read seam — satisfied in production by Firestore `getAll`
 * (Admin SDK, server-only) and by an in-memory fake in tests. `data` is the
 * raw, unvalidated profile candidate (Timestamps mapped to `Date`), or
 * `undefined` when the document does not exist.
 */
export interface ProfileBatchReader {
  readBatch(uids: string[]): Promise<Array<{ uid: string; data: unknown }>>;
}

export interface GetDisplayNamesDeps {
  reader?: ProfileBatchReader;
}

function getDefaultReader(): ProfileBatchReader {
  return {
    async readBatch(uids) {
      const db = getFirestoreDb();
      const refs = uids.map((uid) => db.collection(USER_PROFILES_COLLECTION).doc(uid));
      const snapshots = await db.getAll(...refs);
      return snapshots.map((snapshot) => ({
        uid: snapshot.id,
        data: snapshot.exists ? toProfileCandidate(snapshot.data()) : undefined,
      }));
    },
  };
}

// Document ids Firestore would reject (and that a corrupt membership
// document could still carry); skipped so one bad id never fails a batch.
function isReadableDocumentId(uid: string): boolean {
  return uid.length > 0 && !uid.includes("/") && uid !== "." && uid !== ".." && !/^__.*__$/.test(uid);
}

/**
 * Resolves display names for a *bounded, already-authorized* set of uids (the
 * members of one team whose roster the caller may read) — nothing else. Only
 * a profile that passes the same `isValidUserProfile` check as the own-profile
 * read contributes a name; a missing or corrupt profile is simply absent,
 * never an error and never filled from Firebase Auth or e-mail. Reads are
 * batched (≤ {@link DISPLAY_NAME_BATCH_SIZE} refs each, run concurrently), not
 * one round trip per member. This is deliberately not a general user
 * lookup: it accepts no name/e-mail query and returns only `uid → name`
 * for the uids it was given, for server-internal use. A Firestore failure
 * rejects so the caller can fail closed.
 */
export async function getDisplayNames(
  uids: readonly string[],
  deps: GetDisplayNamesDeps = {},
): Promise<Map<string, string>> {
  const reader = deps.reader ?? getDefaultReader();
  const unique = [...new Set(uids)].filter(isReadableDocumentId);

  const batches: string[][] = [];
  for (let start = 0; start < unique.length; start += DISPLAY_NAME_BATCH_SIZE) {
    batches.push(unique.slice(start, start + DISPLAY_NAME_BATCH_SIZE));
  }

  const results = await Promise.all(batches.map((batch) => reader.readBatch(batch)));

  const names = new Map<string, string>();
  for (const { uid, data } of results.flat()) {
    if (isValidUserProfile(data)) {
      names.set(uid, data.displayName);
    }
  }
  return names;
}

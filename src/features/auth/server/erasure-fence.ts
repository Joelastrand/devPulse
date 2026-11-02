import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";

/**
 * The erasure fence state of one uid, as the auth boundary sees it (TASK-009, BR-4(a)). `malformed` covers any record that
 * cannot be interpreted; it is never coerced into `none`.
 */
export type ErasureFenceState =
  | { kind: "none" }
  | { kind: "in_progress" }
  | { kind: "terminal" }
  | { kind: "malformed" };

export type ReadErasureFence = (uid: string) => Promise<ErasureFenceState>;

/**
 * Server-only erasure record `accountErasures/{uid}` (AE-SI-5). Auth reads it here rather than importing the account-erasure
 * feature: the dependency is one-way (erasure depends on auth, never the reverse).
 */
const ERASURE_COLLECTION = "accountErasures";

/** Interprets raw record data. Anything that is not a known status is `malformed`, so the fence fails closed. */
export function interpretErasureRecord(data: unknown): ErasureFenceState {
  if (typeof data !== "object" || data === null) return { kind: "malformed" };
  const status: unknown = (data as { status?: unknown }).status;
  if (status === "in_progress") return { kind: "in_progress" };
  if (status === "auth_deleted" || status === "completed") return { kind: "terminal" };
  return { kind: "malformed" };
}

/** Reads the fence record of a uid. A Firestore failure rejects; the caller maps it to `auth_unavailable`. */
export async function readErasureFenceFromFirestore(uid: string): Promise<ErasureFenceState> {
  const snapshot = await getFirestoreDb().collection(ERASURE_COLLECTION).doc(uid).get();
  if (!snapshot.exists) return { kind: "none" };
  return interpretErasureRecord(snapshot.data());
}

import "server-only";
import type { Firestore, Transaction } from "firebase-admin/firestore";

/**
 * Transactional write fence for person-owned writes (TASK-004, BR-4(b)). A write that must not commit during erasure
 * reads `accountErasures/{uid}` with the transaction's own `get` and writes in the same transaction. Firestore tracks
 * that read, so a record created before the transaction commits makes the commit fail. A plain document read inside
 * the callback is not tracked and is not accepted here: the helpers only take the `Transaction` type.
 */

/** Server-only erasure record `accountErasures/{uid}`. Same name as `erasure-fence.ts`; auth does not import erasure. */
const ERASURE_COLLECTION = "accountErasures";

/** Refusal of a person-owned write while an erasure record exists for the uid. Maps to `erasure_in_progress`. */
export class ErasureWriteRefused extends Error {
  readonly code = "erasure_in_progress";

  constructor() {
    super("erasure_in_progress");
    this.name = "ErasureWriteRefused";
  }
}

/**
 * Reads the fence inside `tx` and refuses if any record exists. Every state refuses, including a malformed record:
 * the fence fails closed. A read failure rejects and aborts the transaction.
 */
export async function assertNoErasureRecordInTransaction(
  db: Firestore,
  tx: Transaction,
  uid: string,
): Promise<void> {
  const snapshot = await tx.get(db.collection(ERASURE_COLLECTION).doc(uid));
  if (snapshot.exists) throw new ErasureWriteRefused();
}

/**
 * Runs a person-owned write transaction with the fence read first, in the same transaction. The write callback runs only
 * after the fence admits the uid, so a refused write performs no write.
 */
export function runFencedTransaction<T>(
  db: Firestore,
  uid: string,
  write: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.runTransaction(async (tx) => {
    await assertNoErasureRecordInTransaction(db, tx, uid);
    return write(tx);
  });
}

/**
 * The public error for a failed person-owned write (TASK-025). A fence refusal is `erasure_in_progress`; any other failure
 * is the generic `persistence_failed`. The raw error is never returned.
 */
export function writeRefusalFor(error: unknown): "erasure_in_progress" | "persistence_failed" {
  return error instanceof ErasureWriteRefused ? "erasure_in_progress" : "persistence_failed";
}

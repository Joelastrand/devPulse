import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { assertNoErasureRecordInTransaction } from "../../auth/server/erasure-write-fence";
import { SUPERADMIN_COLLECTION, SUPERADMIN_CONTROL_COLLECTION, SUPERADMIN_CONTROL_DOC_ID } from "../domain/superadmin-registry";

/**
 * The reads and queued writes one registry mutation may perform. All reads happen inside `work` before any write is
 * applied, as Firestore requires. Reads return raw, unvalidated data; the caller validates it before trusting it.
 */
export interface SuperadminTransaction {
  readRecord(uid: string): Promise<unknown>;
  readActiveCount(): Promise<unknown>;
  /** Merges fields into `superadmins/{uid}`, creating the record when absent. Applied after `work` returns. */
  mergeRecord(uid: string, fields: Record<string, unknown>): void;
  /** Deletes `superadmins/{uid}` when present. Applied after `work` returns. Used only by the erasure cleanup. */
  deleteRecord(uid: string): void;
  /** Replaces `superadminRegistry/control`. Applied after `work` returns. */
  writeActiveCount(activeCount: number, now: Date): void;
}

/** The fence subjects a mutation touches. Both are refused while an erasure record exists for them. */
export interface SuperadminMutationFence {
  readonly actorUid: string;
  readonly targetUid: string;
}

export interface SuperadminStore {
  /** Non-transactional read of one registry record, for the per-request superadmin policy. Never cached. */
  readRecord(uid: string): Promise<unknown>;
  /** Non-transactional list of records that are currently active. */
  listActiveRecords(): Promise<unknown[]>;
  /**
   * Runs one registry mutation in a single Firestore transaction. Firestore retries `work` on contention, so the
   * decision is always made against the state it writes. Rejects on contention exhaustion or an erasure refusal.
   */
  run<T>(fence: SuperadminMutationFence, work: (tx: SuperadminTransaction) => Promise<T>): Promise<T>;
  /**
   * The same transaction without the erasure fence. Only for the erasure step that owns the erased person's record: that
   * step runs after the fence exists, so the fenced path would refuse it by design.
   */
  runUnfenced<T>(work: (tx: SuperadminTransaction) => Promise<T>): Promise<T>;
}

function recordRef(uid: string) {
  return getFirestoreDb().collection(SUPERADMIN_COLLECTION).doc(uid);
}

function controlRef() {
  return getFirestoreDb().collection(SUPERADMIN_CONTROL_COLLECTION).doc(SUPERADMIN_CONTROL_DOC_ID);
}

async function runRegistryTransaction<T>(
  work: (tx: SuperadminTransaction) => Promise<T>,
  fence: SuperadminMutationFence | undefined,
): Promise<T> {
  const db = getFirestoreDb();
  return db.runTransaction(async (tx) => {
    if (fence !== undefined) {
      await assertNoErasureRecordInTransaction(db, tx, fence.actorUid);
      if (fence.targetUid !== fence.actorUid) {
        await assertNoErasureRecordInTransaction(db, tx, fence.targetUid);
      }
    }

    const queuedWrites: Array<() => void> = [];
    const result = await work({
      async readRecord(uid) {
        const snapshot = await tx.get(recordRef(uid));
        return snapshot.exists ? snapshot.data() : undefined;
      },
      async readActiveCount() {
        const snapshot = await tx.get(controlRef());
        return snapshot.exists ? snapshot.data() : undefined;
      },
      mergeRecord(uid, fields) {
        queuedWrites.push(() => tx.set(recordRef(uid), fields, { merge: true }));
      },
      deleteRecord(uid) {
        queuedWrites.push(() => tx.delete(recordRef(uid)));
      },
      writeActiveCount(activeCount, now) {
        queuedWrites.push(() => tx.set(controlRef(), { activeCount, updatedAt: now }));
      },
    });
    for (const write of queuedWrites) write();
    return result;
  });
}

/**
 * Production store. The erasure fence is read first, inside the same transaction, for the actor and the target, so a
 * registry change cannot land for a uid that is being erased (account-erasure fence, as for every person-owned write).
 */
export function getDefaultSuperadminStore(): SuperadminStore {
  return {
    async readRecord(uid) {
      const snapshot = await recordRef(uid).get();
      return snapshot.exists ? snapshot.data() : undefined;
    },

    async listActiveRecords() {
      const snapshot = await getFirestoreDb()
        .collection(SUPERADMIN_COLLECTION)
        .where("active", "==", true)
        .get();
      return snapshot.docs.map((doc) => ({ docId: doc.id, ...doc.data() }));
    },

    run(fence, work) {
      return runRegistryTransaction(work, fence);
    },

    runUnfenced(work) {
      return runRegistryTransaction(work, undefined);
    },
  };
}

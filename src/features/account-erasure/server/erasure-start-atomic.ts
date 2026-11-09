import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import {
  SUPERADMIN_COLLECTION,
  SUPERADMIN_CONTROL_COLLECTION,
  SUPERADMIN_CONTROL_DOC_ID,
  activeCountAfterRevoke,
  decideRevoke,
  isActiveSuperadmin,
  parseActiveCount,
  parseSuperadminRecord,
} from "../../superadmins/domain/superadmin-registry";
import { ERASURE_COLLECTION, toRawErasureData } from "./erasure-store";
import { parseErasureRecord, toStoredErasureRecord, type ErasureRecord } from "./erasure-store-types";

/**
 * Starts an erasure: creates the fence record and, when the account is an active superadmin, revokes that privilege. Both
 * writes happen in ONE Firestore transaction, so either both commit or neither does.
 *
 * Why this shape (docs/features/account-erasure/SPEC.md, superadmin start rule): the earlier order committed the revoke in
 * one transaction and created the fence in a second. A failed fence creation then left the person demoted with no erasure
 * in progress. A single transaction removes that gap without a cross-transaction claim: Firestore applies the reads and
 * writes of one transaction atomically, and a conflicting concurrent registry write makes this transaction retry.
 *
 * Refusals write nothing: `last_superadmin` (the account is the only active superadmin) and `unavailable` (any read or
 * write failure, or a malformed registry count). The last-superadmin decision uses the same pure rule as every other
 * revoke, read from `superadminRegistry/control` in this transaction.
 */

export type StartErasureAtomicResult =
  | { readonly ok: true; readonly created: boolean; readonly record: ErasureRecord }
  | { readonly ok: false; readonly error: "last_superadmin" | "unavailable" };

/** Reads and writes of one start transaction. Every read happens before the first write. */
export interface ErasureStartTransaction {
  /** Raw erasure record data (Dates converted), or `undefined` when no fence exists. */
  readErasure(uid: string): Promise<unknown>;
  readSuperadmin(uid: string): Promise<unknown>;
  readSuperadminControl(): Promise<unknown>;
  createErasure(uid: string, data: Record<string, unknown>): void;
  /** Marks the superadmin record inactive and sets the control count, both at `now`. */
  revokeSuperadmin(uid: string, activeCount: number, now: Date): void;
}

export interface ErasureStartPort {
  runStartTransaction<T>(work: (tx: ErasureStartTransaction) => Promise<T>): Promise<T>;
}

export async function startErasureAtomically(
  port: ErasureStartPort,
  uid: string,
  now: Date,
): Promise<StartErasureAtomicResult> {
  try {
    return await port.runStartTransaction(async (tx): Promise<StartErasureAtomicResult> => {
      const existingRaw = await tx.readErasure(uid);
      if (existingRaw !== undefined) {
        const existing = parseErasureRecord(existingRaw);
        return existing === undefined ? { ok: false, error: "unavailable" } : { ok: true, created: false, record: existing };
      }

      const record = parseSuperadminRecord(await tx.readSuperadmin(uid), uid);
      if (isActiveSuperadmin(record)) {
        const activeCount = parseActiveCount(await tx.readSuperadminControl());
        if (activeCount === undefined) return { ok: false, error: "unavailable" };
        const decision = decideRevoke({ actorUid: uid, targetUid: uid, actor: record, target: record, activeCount });
        if (!decision.ok) {
          return { ok: false, error: decision.error === "last_superadmin" ? "last_superadmin" : "unavailable" };
        }
        tx.revokeSuperadmin(uid, activeCountAfterRevoke(activeCount), now);
      }

      const fence: ErasureRecord = { status: "in_progress", step: "forum", startedAt: now, updatedAt: now };
      tx.createErasure(uid, toStoredErasureRecord(fence));
      return { ok: true, created: true, record: fence };
    });
  } catch {
    // Any thrown error aborts the transaction, so nothing was written. The start stays retryable.
    return { ok: false, error: "unavailable" };
  }
}

/** Admin SDK adapter. The three documents are read through the transaction, so the commit fails on a concurrent change. */
export function getDefaultErasureStartPort(): ErasureStartPort {
  return {
    runStartTransaction(work) {
      const db = getFirestoreDb();
      const erasureRef = (uid: string) => db.collection(ERASURE_COLLECTION).doc(uid);
      const superadminRef = (uid: string) => db.collection(SUPERADMIN_COLLECTION).doc(uid);
      const controlRef = () => db.collection(SUPERADMIN_CONTROL_COLLECTION).doc(SUPERADMIN_CONTROL_DOC_ID);
      return db.runTransaction((tx) =>
        work({
          async readErasure(uid) {
            const snapshot = await tx.get(erasureRef(uid));
            return snapshot.exists ? toRawErasureData(snapshot.data()) : undefined;
          },
          async readSuperadmin(uid) {
            const snapshot = await tx.get(superadminRef(uid));
            return snapshot.exists ? snapshot.data() : undefined;
          },
          async readSuperadminControl() {
            const snapshot = await tx.get(controlRef());
            return snapshot.exists ? snapshot.data() : undefined;
          },
          createErasure(uid, data) {
            tx.create(erasureRef(uid), data);
          },
          revokeSuperadmin(uid, activeCount, now) {
            tx.set(superadminRef(uid), { active: false, revokedAt: now, revokedByUid: uid, updatedAt: now }, { merge: true });
            tx.set(controlRef(), { activeCount, updatedAt: now });
          },
        }),
      );
    },
  };
}

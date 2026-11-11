import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { runFencedTransaction } from "../../auth/server/erasure-write-fence";
import { isAddressableRecordId } from "../domain/constants";
import type { RecordCollection } from "../domain/record-schema";

/**
 * Persistence for responsibilities and achievements (SPEC AR-1; SECURITY.md PR-SI-1). The store is a boundary only: it
 * returns raw data with timestamps mapped to `Date`, and never validates, decrypts, authorizes or repairs. Every path is built
 * from the verified owner uid passed in by the operation; there is no query across owners and no collection group.
 */

export interface RawRecord {
  id: string;
  data: Record<string, unknown>;
}

/** The writes and reads one fenced transaction may perform on a single person's record collections. */
export interface RecordTransaction {
  get(collection: RecordCollection, id: string): Promise<Record<string, unknown> | undefined>;
  set(collection: RecordCollection, id: string, data: Record<string, unknown>): void;
  delete(collection: RecordCollection, id: string): void;
  newId(collection: RecordCollection): string;
}

export interface PersonalRecordStore {
  /** Up to `limit` documents of one collection, in id order, without decryption. A read failure rejects. */
  list(ownerUid: string, collection: RecordCollection, limit: number): Promise<RawRecord[]>;
  /** One raw document by id, without decryption, for owner-scoped source reads. `undefined` when absent. A read failure rejects. */
  get(ownerUid: string, collection: RecordCollection, id: string): Promise<RawRecord | undefined>;
  /** Existence-only read of one document, used for link checks. Returns `false` for an absent document. */
  exists(ownerUid: string, collection: RecordCollection, id: string): Promise<boolean>;
  /** Runs `work` in one transaction guarded by the erasure fence (W-19 to W-21). Refusal rejects with `ErasureWriteRefused`. */
  runFenced<T>(ownerUid: string, work: (tx: RecordTransaction) => Promise<T>): Promise<T>;
}

const USER_DEVELOPMENT = "userDevelopment";

/** Each collection path is a literal here, so the account-erasure tripwire can resolve every subtree it touches. */
function ownerCollection(ownerUid: string, collection: RecordCollection) {
  if (!isSafeSegment(ownerUid)) throw new Error("invalid owner segment");
  const owner = getFirestoreDb().collection(USER_DEVELOPMENT).doc(ownerUid);
  return collection === "responsibilities" ? owner.collection("responsibilities") : owner.collection("achievements");
}

function isSafeSegment(value: string): boolean {
  return value.length > 0 && !value.includes("/") && value !== "." && value !== "..";
}

/** Timestamps become `Date`s; everything else passes through unchanged for the schema to judge. */
function mapTimestamps(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, value instanceof Timestamp ? value.toDate() : value]),
  );
}

/** `Date`s become Firestore `Timestamp`s on write; nothing else is converted. */
function toFirestoreData(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, value instanceof Date ? Timestamp.fromDate(value) : value]),
  );
}

export function getDefaultPersonalRecordStore(): PersonalRecordStore {
  return {
    async list(ownerUid, collection, limit) {
      const snapshot = await ownerCollection(ownerUid, collection).limit(limit).get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: mapTimestamps(doc.data()) }));
    },
    async get(ownerUid, collection, id) {
      if (!isAddressableRecordId(id)) return undefined;
      const snapshot = await ownerCollection(ownerUid, collection).doc(id).get();
      return snapshot.exists ? { id: snapshot.id, data: mapTimestamps(snapshot.data() ?? {}) } : undefined;
    },
    async exists(ownerUid, collection, id) {
      if (!isAddressableRecordId(id)) return false;
      const snapshot = await ownerCollection(ownerUid, collection).doc(id).get();
      return snapshot.exists;
    },
    runFenced(ownerUid, work) {
      const db = getFirestoreDb();
      return runFencedTransaction(db, ownerUid, (tx) =>
        work({
          async get(collection, id) {
            assertRecordId(id);
            const snapshot = await tx.get(ownerCollection(ownerUid, collection).doc(id));
            return snapshot.exists ? mapTimestamps(snapshot.data() ?? {}) : undefined;
          },
          set(collection, id, data) {
            assertRecordId(id);
            tx.set(ownerCollection(ownerUid, collection).doc(id), toFirestoreData(data));
          },
          delete(collection, id) {
            assertRecordId(id);
            tx.delete(ownerCollection(ownerUid, collection).doc(id));
          },
          newId(collection) {
            return ownerCollection(ownerUid, collection).doc().id;
          },
        }),
      );
    },
  };
}

function assertRecordId(id: string): void {
  if (!isAddressableRecordId(id)) throw new Error("invalid record id");
}

import { ErasureWriteRefused } from "../../auth/server/erasure-write-fence";
import type { RecordCollection } from "../domain/record-schema";
import type { PersonalRecordStore, RawRecord, RecordTransaction } from "./personal-record-store";

/**
 * In-memory {@link PersonalRecordStore} for unit tests. It keeps raw documents exactly as a store would (timestamps as `Date`),
 * simulates the erasure fence with `fencedUids`, and applies a transaction's writes only when the callback completes.
 * It is test support: no production code imports it.
 */
export class FakePersonalRecordStore implements PersonalRecordStore {
  private readonly documents = new Map<string, Map<string, Map<string, Record<string, unknown>>>>();
  private counter = 0;
  readonly fencedUids = new Set<string>();

  private docsOf(ownerUid: string, collection: RecordCollection): Map<string, Record<string, unknown>> {
    const owner = this.documents.get(ownerUid) ?? new Map<string, Map<string, Record<string, unknown>>>();
    this.documents.set(ownerUid, owner);
    const docs = owner.get(collection) ?? new Map<string, Record<string, unknown>>();
    owner.set(collection, docs);
    return docs;
  }

  /** Test seeding and inspection: a copy of the stored document, or `undefined`. */
  peek(ownerUid: string, collection: RecordCollection, id: string): Record<string, unknown> | undefined {
    const data = this.docsOf(ownerUid, collection).get(id);
    return data === undefined ? undefined : { ...data };
  }

  seed(ownerUid: string, collection: RecordCollection, id: string, data: Record<string, unknown>): void {
    this.docsOf(ownerUid, collection).set(id, { ...data });
  }

  count(ownerUid: string, collection: RecordCollection): number {
    return this.docsOf(ownerUid, collection).size;
  }

  async list(ownerUid: string, collection: RecordCollection, limit: number): Promise<RawRecord[]> {
    return [...this.docsOf(ownerUid, collection).entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, limit)
      .map(([id, data]) => ({ id, data: { ...data } }));
  }

  async get(ownerUid: string, collection: RecordCollection, id: string): Promise<RawRecord | undefined> {
    const data = this.docsOf(ownerUid, collection).get(id);
    return data === undefined ? undefined : { id, data: { ...data } };
  }

  async exists(ownerUid: string, collection: RecordCollection, id: string): Promise<boolean> {
    return this.docsOf(ownerUid, collection).has(id);
  }

  async runFenced<T>(ownerUid: string, work: (tx: RecordTransaction) => Promise<T>): Promise<T> {
    if (this.fencedUids.has(ownerUid)) throw new ErasureWriteRefused();
    const pending: Array<() => void> = [];
    const tx: RecordTransaction = {
      get: async (collection, id) => {
        const data = this.docsOf(ownerUid, collection).get(id);
        return data === undefined ? undefined : { ...data };
      },
      set: (collection, id, data) => {
        pending.push(() => this.docsOf(ownerUid, collection).set(id, { ...data }));
      },
      delete: (collection, id) => {
        pending.push(() => this.docsOf(ownerUid, collection).delete(id));
      },
      newId: () => {
        this.counter += 1;
        return `rec-${this.counter}`;
      },
    };
    const result = await work(tx);
    for (const apply of pending) apply();
    return result;
  }
}

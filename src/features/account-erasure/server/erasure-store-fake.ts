import type { ErasureStorePort, ErasureTransaction } from "./erasure-store-types";

/**
 * In-memory erasure store for tests. Transaction semantics mirror the Admin SDK where they matter here:
 * reads and writes happen on a draft copy, the draft commits only when the callback resolves, a `create` on an
 * existing record and an `update` on a missing one throw, and a read can be made to fail once.
 */
export interface FakeErasureStore extends ErasureStorePort {
  /** Committed documents, keyed by uid. */
  readonly documents: ReadonlyMap<string, Record<string, unknown>>;
  /** uids read through `tx.get` inside a transaction, in order. Proves the fence read used the transaction. */
  readonly transactionalReads: string[];
  seed(uid: string, data: Record<string, unknown>): void;
  /** The next `tx.get` throws, as a Firestore outage would. */
  failNextRead(): void;
}

export function createFakeErasureStore(): FakeErasureStore {
  const committed = new Map<string, Record<string, unknown>>();
  const transactionalReads: string[] = [];
  let failNext = false;

  return {
    documents: committed,
    transactionalReads,
    seed(uid, data) {
      committed.set(uid, structuredClone(data));
    },
    failNextRead() {
      failNext = true;
    },
    async runTransaction(work) {
      const draft = new Map(
        [...committed].map(([uid, data]) => [uid, structuredClone(data)] as const),
      );

      const tx: ErasureTransaction = {
        async get(uid) {
          transactionalReads.push(uid);
          if (failNext) {
            failNext = false;
            throw new Error("simulated read failure");
          }
          const data = draft.get(uid);
          return data === undefined ? undefined : structuredClone(data);
        },
        create(uid, data) {
          if (draft.has(uid)) throw new Error("already exists");
          draft.set(uid, structuredClone(data));
        },
        update(uid, patch) {
          const existing = draft.get(uid);
          if (existing === undefined) throw new Error("not found");
          draft.set(uid, { ...existing, ...structuredClone(patch) });
        },
      };

      const result = await work(tx);
      committed.clear();
      for (const [uid, data] of draft) committed.set(uid, data);
      return result;
    },
  };
}

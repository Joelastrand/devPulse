import type { ErasureStorePort, ErasureTransaction } from "./erasure-store-types";
import type { ErasureStartPort, ErasureStartTransaction } from "./erasure-start-atomic";

/**
 * In-memory erasure store for tests. Transaction semantics mirror the Admin SDK where they matter here:
 * reads and writes happen on a draft copy, the draft commits only when the callback resolves, a `create` on an
 * existing record and an `update` on a missing one throw, and a read can be made to fail once.
 *
 * `runStartTransaction` models the atomic erasure start: the fence, the superadmin record and the registry count share one
 * draft, so a failure in any write discards all of them (the property the production transaction relies on).
 */
export interface FakeErasureStore extends ErasureStorePort, ErasureStartPort {
  /** Committed documents, keyed by uid. */
  readonly documents: ReadonlyMap<string, Record<string, unknown>>;
  /** Committed superadmin records, keyed by uid. */
  readonly superadmins: ReadonlyMap<string, Record<string, unknown>>;
  /** Committed `superadminRegistry/control` data, or undefined when absent. */
  readonly control: { readonly activeCount?: number } | undefined;
  /** uids read through `tx.get` inside a transaction, in order. Proves the fence read used the transaction. */
  readonly transactionalReads: string[];
  seed(uid: string, data: Record<string, unknown>): void;
  seedSuperadmin(uid: string, active: boolean): void;
  seedControl(activeCount: number): void;
  /** The next `tx.get` throws, as a Firestore outage would. */
  failNextRead(): void;
  /** The next erasure-fence `create` in a start transaction throws, as a rejected write would. */
  failNextFenceCreate(): void;
}

export function createFakeErasureStore(): FakeErasureStore {
  const committed = new Map<string, Record<string, unknown>>();
  const committedSuperadmins = new Map<string, Record<string, unknown>>();
  let committedControl: Record<string, unknown> | undefined;
  const transactionalReads: string[] = [];
  let failNext = false;
  let failFenceCreate = false;

  return {
    documents: committed,
    superadmins: committedSuperadmins,
    get control() {
      return committedControl as { readonly activeCount?: number } | undefined;
    },
    transactionalReads,
    seed(uid, data) {
      committed.set(uid, structuredClone(data));
    },
    seedSuperadmin(uid, active) {
      committedSuperadmins.set(uid, { uid, active });
    },
    seedControl(activeCount) {
      committedControl = { activeCount };
    },
    failNextRead() {
      failNext = true;
    },
    failNextFenceCreate() {
      failFenceCreate = true;
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
    async runStartTransaction(work) {
      const draftErasures = new Map(
        [...committed].map(([uid, data]) => [uid, structuredClone(data)] as const),
      );
      const draftSuperadmins = new Map(
        [...committedSuperadmins].map(([uid, data]) => [uid, structuredClone(data)] as const),
      );
      let draftControl = committedControl === undefined ? undefined : structuredClone(committedControl);
      const pendingWrites: Array<() => void> = [];

      const tx: ErasureStartTransaction = {
        async readErasure(uid) {
          transactionalReads.push(uid);
          const data = draftErasures.get(uid);
          return data === undefined ? undefined : structuredClone(data);
        },
        async readSuperadmin(uid) {
          const data = draftSuperadmins.get(uid);
          return data === undefined ? undefined : structuredClone(data);
        },
        async readSuperadminControl() {
          return draftControl === undefined ? undefined : structuredClone(draftControl);
        },
        createErasure(uid, data) {
          pendingWrites.push(() => {
            if (failFenceCreate) {
              failFenceCreate = false;
              throw new Error("simulated fence write failure");
            }
            if (draftErasures.has(uid)) throw new Error("already exists");
            draftErasures.set(uid, structuredClone(data));
          });
        },
        revokeSuperadmin(uid, activeCount, now) {
          pendingWrites.push(() => {
            const current = draftSuperadmins.get(uid) ?? { uid };
            draftSuperadmins.set(uid, { ...current, active: false, revokedAt: now, revokedByUid: uid, updatedAt: now });
            draftControl = { activeCount, updatedAt: now };
          });
        },
      };

      const result = await work(tx);
      // Writes are applied only after every read, as Firestore requires. A throwing write rejects the whole call and no
      // draft reaches the committed maps.
      for (const write of pendingWrites) write();
      committed.clear();
      for (const [uid, data] of draftErasures) committed.set(uid, data);
      committedSuperadmins.clear();
      for (const [uid, data] of draftSuperadmins) committedSuperadmins.set(uid, data);
      committedControl = draftControl;
      return result;
    },
  };
}

import "server-only";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

/**
 * Test-only recording double of the Admin Firestore surface the conversation store uses (server-only, never imported by
 * production code). It never contacts Firebase. It mirrors the Firestore rules the store relies on: an `orderBy` query
 * leaves out documents without the ordered field; `limit` cuts the result; `select` projects fields; `count()` counts
 * every document; a transaction buffers its writes and applies them together, and rejects a read after a write.
 *
 * `calls` records each query chain and each count, so tests can assert the exact bounded query shape.
 */

type Data = Record<string, unknown>;

interface Order {
  field: string;
  direction: "asc" | "desc";
}

export interface AdminFirestoreDouble {
  /** Pass to the store under test, cast to the Admin `Firestore` type. */
  db: Firestore;
  /** Stored documents by full path, for inspection. */
  documents: Map<string, Data>;
  /** Recorded query chains and counts, in call order. */
  calls: string[];
}

/** Direct children of a collection path, in id order. */
function childrenOf(documents: Map<string, Data>, collectionPath: string): Array<{ id: string; path: string; data: Data }> {
  const prefix = `${collectionPath}/`;
  return [...documents.entries()]
    .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
    .map(([path, data]) => ({ id: path.slice(prefix.length), path, data }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The numeric sort value of an ordered field: milliseconds for timestamps and dates, `NaN` otherwise. */
function sortValue(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Number.NaN;
}

function snapshotOf(id: string, data: Data | undefined) {
  return {
    id,
    exists: data !== undefined,
    data: () => (data === undefined ? undefined : { ...data }),
  };
}

export function createAdminFirestoreDouble(): AdminFirestoreDouble {
  const documents = new Map<string, Data>();
  const calls: string[] = [];
  let autoSequence = 0;

  function docRef(path: string) {
    const id = path.slice(path.lastIndexOf("/") + 1);
    return {
      id,
      path,
      collection: (name: string) => collectionRef(`${path}/${name}`),
      async get() {
        return snapshotOf(id, documents.get(path));
      },
      async create(data: Data) {
        if (documents.has(path)) throw new Error("ALREADY_EXISTS");
        documents.set(path, { ...data });
      },
      async set(data: Data) {
        documents.set(path, { ...data });
      },
      async update(data: Data) {
        const existing = documents.get(path);
        if (existing === undefined) throw new Error("NOT_FOUND");
        documents.set(path, { ...existing, ...data });
      },
      async delete() {
        documents.delete(path);
      },
    };
  }

  function query(collectionPath: string, orders: Order[], limitCount: number | undefined, projection: string | undefined, chain: string[]) {
    return {
      doc(id?: string) {
        if (id !== undefined) return docRef(`${collectionPath}/${id}`);
        autoSequence += 1;
        return docRef(`${collectionPath}/auto-${String(autoSequence).padStart(6, "0")}`);
      },
      orderBy(field: string, direction: "asc" | "desc" = "asc") {
        return query(collectionPath, [...orders, { field, direction }], limitCount, projection, [...chain, `orderBy(${field},${direction})`]);
      },
      limit(count: number) {
        return query(collectionPath, orders, count, projection, [...chain, `limit(${count})`]);
      },
      select(field: string) {
        return query(collectionPath, orders, limitCount, field, [...chain, `select(${field})`]);
      },
      count() {
        return {
          async get() {
            calls.push(`count ${collectionPath}`);
            return { data: () => ({ count: childrenOf(documents, collectionPath).length }) };
          },
        };
      },
      async get() {
        calls.push([collectionPath, ...chain, "get"].join("|"));
        let matched = childrenOf(documents, collectionPath);
        for (const order of orders.slice(0, 1)) {
          // A document without the ordered field is not part of an ordered query (Firestore semantics).
          matched = matched
            .filter((doc) => doc.data[order.field] !== undefined)
            .sort((a, b) => {
              const byValue = sortValue(a.data[order.field]) - sortValue(b.data[order.field]);
              const byId = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
              const ordered = byValue === 0 || Number.isNaN(byValue) ? byId : byValue;
              return order.direction === "desc" ? -ordered : ordered;
            });
        }
        if (limitCount !== undefined) matched = matched.slice(0, limitCount);
        const docs = matched.map((doc) => {
          const data = projection === undefined ? doc.data : Object.fromEntries(Object.entries(doc.data).filter(([key]) => key === projection));
          return { id: doc.id, exists: true, data: () => ({ ...data }) };
        });
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    };
  }

  function collectionRef(path: string) {
    return query(path, [], undefined, undefined, []);
  }

  const db = {
    collection: (name: string) => collectionRef(name),
    async runTransaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
      // Writes go to a draft and are applied only when `work` resolves, as a Firestore transaction commits.
      const draft = new Map(documents);
      let wrote = false;
      const tx = {
        async get(ref: { path: string; id: string }) {
          if (wrote) throw new Error("reads must precede writes in a transaction");
          return snapshotOf(ref.id, draft.get(ref.path));
        },
        create(ref: { path: string }, data: Data) {
          wrote = true;
          if (draft.has(ref.path)) throw new Error("ALREADY_EXISTS");
          draft.set(ref.path, { ...data });
        },
        set(ref: { path: string }, data: Data) {
          wrote = true;
          draft.set(ref.path, { ...data });
        },
        update(ref: { path: string }, data: Data) {
          wrote = true;
          const existing = draft.get(ref.path);
          if (existing === undefined) throw new Error("NOT_FOUND");
          draft.set(ref.path, { ...existing, ...data });
        },
        delete(ref: { path: string }) {
          wrote = true;
          draft.delete(ref.path);
        },
      };
      const result = await work(tx);
      documents.clear();
      for (const [path, data] of draft) documents.set(path, data);
      return result;
    },
  };

  return { db: db as unknown as Firestore, documents, calls };
}

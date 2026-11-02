/**
 * Recording double of the Firebase Admin Firestore surface used by the production erasure adapters (TASK-038). It
 * supports only the calls those adapters make, and throws on anything else, so a test cannot pass through an unmodelled
 * call. It is a structural double, not Firestore: transaction conflict behaviour is the D-EMU gate. Test-only.
 */

import { FieldPath, FieldValue } from "firebase-admin/firestore";

type Data = Record<string, unknown>;
const DOC_ID = "__name__";

export interface RecordedWrite {
  readonly kind: "create" | "set" | "update" | "delete";
  readonly path: string;
  readonly data?: Data;
}

export class FakeAdminFirestore {
  readonly docs = new Map<string, Data>();
  readonly writes: RecordedWrite[] = [];
  readonly reads: string[] = [];
  /** Paths read inside a transaction, in order. */
  readonly transactionalReads: string[] = [];

  collection(path: string): CollectionDouble {
    return new CollectionDouble(this, path, []);
  }

  doc(path: string): DocDouble {
    return new DocDouble(this, path);
  }

  /** A collection-group query: every document whose immediate collection id is `name`, at any depth. */
  collectionGroup(name: string): CollectionDouble {
    return new CollectionDouble(this, `*/${name}`, [], undefined, true);
  }

  batch(): never {
    throw new Error("admin double: batch is not modelled");
  }

  async runTransaction<T>(work: (tx: TransactionDouble) => Promise<T>): Promise<T> {
    const pending: Array<() => void> = [];
    const tx = new TransactionDouble(this, pending);
    const result = await work(tx);
    for (const apply of pending) apply();
    return result;
  }

  get documentIds(): string[] {
    return [...this.docs.keys()];
  }
}

export class DocDouble {
  constructor(
    readonly db: FakeAdminFirestore,
    readonly path: string,
  ) {}

  get id(): string {
    return this.path.split("/").at(-1) as string;
  }

  async get(): Promise<SnapshotDouble> {
    this.db.reads.push(this.path);
    return snapshotOf(this.db, this.path);
  }

  collection(name: string): CollectionDouble {
    return new CollectionDouble(this.db, `${this.path}/${name}`, []);
  }

  async delete(): Promise<void> {
    this.db.docs.delete(this.path);
    this.db.writes.push({ kind: "delete", path: this.path });
  }
}

export class CollectionDouble {
  constructor(
    readonly db: FakeAdminFirestore,
    readonly path: string,
    readonly filters: ReadonlyArray<{ field: string; op: string; value: unknown }>,
    readonly max: number | undefined = undefined,
    readonly group = false,
  ) {}

  doc(id: string): DocDouble {
    return new DocDouble(this.db, `${this.path}/${id}`);
  }

  where(field: unknown, op: string, value: unknown): CollectionDouble {
    if (op !== "==" && op !== ">=" && op !== "<") throw new Error(`admin double: operator ${op} not modelled`);
    return new CollectionDouble(this.db, this.path, [...this.filters, { field: fieldName(field), op, value }], this.max, this.group);
  }

  select(): CollectionDouble {
    return this;
  }

  limit(n: number): CollectionDouble {
    return new CollectionDouble(this.db, this.path, this.filters, n, this.group);
  }

  count(): { get(): Promise<{ data(): { count: number } }> } {
    return {
      get: async () => ({ data: () => ({ count: matching(this.db, this.path, this.filters).length }) }),
    };
  }

  async get(): Promise<{ docs: SnapshotDouble[]; size: number }> {
    this.db.reads.push(this.path);
    return this.snapshot();
  }

  /** The documents this query matches, without recording a read (the caller records it). */
  snapshot(): { docs: SnapshotDouble[]; size: number } {
    const found = this.group ? matchingGroup(this.db, this.path.slice(2), this.filters) : matching(this.db, this.path, this.filters);
    const limited = this.max === undefined ? found : found.slice(0, this.max);
    const docs = limited.map((p) => snapshotOf(this.db, p));
    return { docs, size: docs.length };
  }
}

export class TransactionDouble {
  constructor(
    private readonly db: FakeAdminFirestore,
    private readonly pending: Array<() => void>,
  ) {}

  async get(ref: DocDouble): Promise<SnapshotDouble>;
  async get(query: CollectionDouble): Promise<{ docs: SnapshotDouble[]; size: number }>;
  async get(target: DocDouble | CollectionDouble): Promise<SnapshotDouble | { docs: SnapshotDouble[] }> {
    if (target instanceof CollectionDouble) {
      this.db.transactionalReads.push(target.path);
      return target.snapshot();
    }
    this.db.transactionalReads.push(target.path);
    return snapshotOf(this.db, target.path);
  }

  create(ref: DocDouble, data: Data): void {
    this.pending.push(() => {
      if (this.db.docs.has(ref.path)) throw new Error("ALREADY_EXISTS");
      this.db.docs.set(ref.path, { ...data });
      this.db.writes.push({ kind: "create", path: ref.path, data });
    });
  }

  set(ref: DocDouble, data: Data): void {
    this.pending.push(() => {
      this.db.docs.set(ref.path, { ...data });
      this.db.writes.push({ kind: "set", path: ref.path, data });
    });
  }

  update(ref: DocDouble, data: Data): void {
    this.pending.push(() => {
      if (!this.db.docs.has(ref.path)) throw new Error("NOT_FOUND");
      const merged = { ...this.db.docs.get(ref.path) };
      for (const [key, value] of Object.entries(data)) {
        if (value instanceof FieldValue && value.isEqual(FieldValue.delete())) delete merged[key];
        else merged[key] = value;
      }
      this.db.docs.set(ref.path, merged);
      this.db.writes.push({ kind: "update", path: ref.path, data });
    });
  }

  delete(ref: DocDouble): void {
    this.pending.push(() => {
      this.db.docs.delete(ref.path);
      this.db.writes.push({ kind: "delete", path: ref.path });
    });
  }
}

export interface SnapshotDouble {
  readonly id: string;
  readonly exists: boolean;
  data(): Data | undefined;
  readonly ref: DocDouble;
}


/** A real `FieldPath.documentId()` from the production code maps to the document id; any other field path is unsupported. */
function fieldName(field: unknown): string {
  if (typeof field === "string") return field;
  if (field instanceof FieldPath && field.isEqual(FieldPath.documentId())) return DOC_ID;
  throw new Error("admin double: unsupported field path");
}

function snapshotOf(db: FakeAdminFirestore, path: string): SnapshotDouble {
  const data = db.docs.get(path);
  return {
    id: path.split("/").at(-1) as string,
    exists: data !== undefined,
    data: () => (data === undefined ? undefined : { ...data }),
    ref: new DocDouble(db, path),
  };
}

/** Every document whose immediate collection id is `name`, at any depth, that satisfies every filter. */
function matchingGroup(db: FakeAdminFirestore, name: string, filters: CollectionDouble["filters"]): string[] {
  return [...db.docs.keys()]
    .filter((path) => {
      const segments = path.split("/");
      return segments.length >= 2 && segments[segments.length - 2] === name;
    })
    .filter((path) => filters.every((f) => passes(db, path, f)))
    .sort();
}

/** Documents directly under `collectionPath` that satisfy every filter, in stable path order. */
function matching(db: FakeAdminFirestore, collectionPath: string, filters: CollectionDouble["filters"]): string[] {
  const prefix = `${collectionPath}/`;
  return [...db.docs.keys()]
    .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
    .filter((path) => filters.every((f) => passes(db, path, f)))
    .sort();
}

function passes(db: FakeAdminFirestore, path: string, f: { field: string; op: string; value: unknown }): boolean {
  const id = path.split("/").at(-1) as string;
  const actual: unknown = f.field === DOC_ID ? id : db.docs.get(path)?.[f.field];
  if (f.op === "==") return actual === f.value;
  if (f.op === ">=") return typeof actual === "string" && actual >= (f.value as string);
  if (f.op === "<") return typeof actual === "string" && actual < (f.value as string);
  return false;
}

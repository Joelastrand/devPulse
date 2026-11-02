import { describe, expect, it, vi } from "vitest";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { ErasureWriteRefused, runFencedTransaction } from "./erasure-write-fence";

// Structural tests only. They prove the fence read goes through the transaction and that a refused write mutates nothing.
// They do not model Firestore's commit-ordering race; that is the manual D-EMU gate (account-erasure TASK-004).

type Doc = { path: string };

interface FakeDb {
  readonly getSpy: ReturnType<typeof vi.fn>;
  readonly txGets: string[];
  readonly writes: string[];
  readonly order: string[];
  db: Firestore;
  setRecord(uid: string, data: unknown): void;
  failRead(): void;
}

/**
 * A fake Firestore. `db.doc(...).get` is a spy that must never be called by the helpers: the fence read has to be the
 * transaction's own `get`. Records are keyed by document path.
 */
function createFakeDb(): FakeDb {
  const records = new Map<string, unknown>();
  const txGets: string[] = [];
  const writes: string[] = [];
  const order: string[] = [];
  let readFails = false;
  const getSpy = vi.fn(async () => {
    throw new Error("plain document get must not be used for the fence");
  });

  const docRef = (path: string): Doc & { get: typeof getSpy } => ({ path, get: getSpy });

  const tx = {
    get: async (ref: Doc) => {
      order.push(`get:${ref.path}`);
      txGets.push(ref.path);
      if (readFails) throw new Error("firestore unavailable");
      const data = records.get(ref.path);
      return { exists: records.has(ref.path), data: () => data };
    },
    set: (ref: Doc) => {
      order.push(`set:${ref.path}`);
      writes.push(ref.path);
    },
  } as unknown as Transaction;

  const db = {
    collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }),
    runTransaction: async <T>(work: (t: Transaction) => Promise<T>) => work(tx),
  } as unknown as Firestore;

  return {
    getSpy,
    txGets,
    writes,
    order,
    db,
    setRecord(uid, data) {
      records.set(`accountErasures/${uid}`, data);
    },
    failRead() {
      readFails = true;
    },
  };
}

describe("runFencedTransaction (TASK-004 automated fence)", () => {
  it("reads the erasure record through the transaction, at accountErasures/{uid}", async () => {
    const fake = createFakeDb();
    await runFencedTransaction(fake.db, "uid-a", async () => undefined);
    expect(fake.txGets).toEqual(["accountErasures/uid-a"]);
  });

  it("never uses a plain document get for the fence read", async () => {
    const fake = createFakeDb();
    await runFencedTransaction(fake.db, "uid-a", async () => undefined);
    expect(fake.getSpy).not.toHaveBeenCalled();
  });

  it("runs the protected write after the fence read in the same transaction", async () => {
    const fake = createFakeDb();
    const result = await runFencedTransaction(fake.db, "uid-a", async (tx) => {
      (tx as unknown as { set(ref: Doc): void }).set({ path: "userProfiles/uid-a" });
      return "written";
    });
    expect(result).toBe("written");
    expect(fake.order).toEqual(["get:accountErasures/uid-a", "set:userProfiles/uid-a"]);
  });

  it("admits the write when no erasure record exists", async () => {
    const fake = createFakeDb();
    const write = vi.fn(async () => "ok");
    await expect(runFencedTransaction(fake.db, "uid-a", write)).resolves.toBe("ok");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["in_progress", { status: "in_progress" }],
    ["auth_deleted", { status: "auth_deleted" }],
    ["completed", { status: "completed" }],
    ["malformed", { status: "reopened" }],
  ])("refuses with erasure_in_progress for a %s record and performs no write", async (_label, data) => {
    const fake = createFakeDb();
    fake.setRecord("uid-a", data);
    const write = vi.fn(async (tx: Transaction) => {
      (tx as unknown as { set(ref: Doc): void }).set({ path: "userProfiles/uid-a" });
    });

    const outcome = await runFencedTransaction(fake.db, "uid-a", write).catch((error: unknown) => error);

    expect(outcome).toBeInstanceOf(ErasureWriteRefused);
    expect((outcome as ErasureWriteRefused).code).toBe("erasure_in_progress");
    expect(write).not.toHaveBeenCalled();
    expect(fake.writes).toEqual([]);
  });

  it("does not run the write when the transactional fence read fails, so the write fails closed", async () => {
    const fake = createFakeDb();
    fake.failRead();
    const write = vi.fn(async () => "ok");

    await expect(runFencedTransaction(fake.db, "uid-a", write)).rejects.toThrow("firestore unavailable");
    expect(write).not.toHaveBeenCalled();
    expect(fake.writes).toEqual([]);
  });

  it("refuses when a record exists even if its data cannot be read (fail closed, never treated as absent)", async () => {
    const fake = createFakeDb();
    fake.setRecord("uid-a", undefined);
    const write = vi.fn(async () => "ok");
    await expect(runFencedTransaction(fake.db, "uid-a", write)).rejects.toBeInstanceOf(ErasureWriteRefused);
    expect(write).not.toHaveBeenCalled();
  });

  it("fences each uid on its own record, so another uid's record does not refuse this write", async () => {
    const fake = createFakeDb();
    fake.setRecord("uid-b", { status: "in_progress" });
    await expect(runFencedTransaction(fake.db, "uid-a", async () => "ok")).resolves.toBe("ok");
  });
});

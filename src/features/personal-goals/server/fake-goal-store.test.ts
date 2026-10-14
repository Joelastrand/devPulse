import { describe, expect, it } from "vitest";
import { applyGoalChange, createGoal, parseStoredGoal, type Goal } from "../domain/goal";
import { createFakeGoalStore } from "./fake-goal-store";
import { InvalidGoalStoreKeyError } from "./goal-store-types";

const BASE = Date.UTC(2026, 0, 1);
const at = (n: number) => new Date(BASE + n * 1000);

const validData = (createdAtSeconds: number, title = "Mål") => ({
  title,
  status: "active",
  createdAt: at(createdAtSeconds),
  updatedAt: at(createdAtSeconds),
});

const goalAt = (n: number, title = "Mål"): Goal => createGoal({ title }, at(n));
const id = (n: number) => `g${String(n).padStart(4, "0")}`;

describe("fake goal store — create and canonical keys", () => {
  it("creates with generated ids, persisting exactly the canonical keys and nothing else", async () => {
    const { store, peek } = createFakeGoalStore();
    const goalId = await store.create("u1", createGoal({ title: "Lær Rust", treeId: "t1", targetDate: "2026-12-31" }, at(1)));
    expect(Object.keys(peek("u1", goalId) ?? {}).sort()).toEqual(["createdAt", "status", "targetDate", "title", "treeId", "updatedAt"]);
    const done = applyGoalChange(goalAt(1), { status: "completed" }, at(2));
    if (!done.changed) throw new Error("fixture");
    const completedId = await store.create("u1", done.goal);
    expect(Object.keys(peek("u1", completedId) ?? {}).sort()).toEqual(["completedAt", "createdAt", "status", "title", "updatedAt"]);
  });

  it("round-trips a canonical goal: create, raw read, parse", async () => {
    const { store } = createFakeGoalStore();
    const goal = goalAt(5, "Round trip");
    const goalId = await store.create("u1", goal);
    expect(parseStoredGoal(await store.get("u1", goalId))).toEqual({ ok: true, goal });
  });

  it("uses an injected id generator and never overwrites an existing document", async () => {
    const { store } = createFakeGoalStore({ generateId: () => "sameId" });
    await store.create("u1", goalAt(1));
    await expect(store.create("u1", goalAt(2))).rejects.toThrow("already exists");
  });

  it("does not clamp or rewrite a regressed timestamp (BR-64)", async () => {
    const { store, peek } = createFakeGoalStore();
    const regressed: Goal = { ...goalAt(10), updatedAt: at(3) };
    const goalId = await store.create("u1", regressed);
    expect(peek("u1", goalId)?.updatedAt).toEqual(at(3));
  });
});

describe("fake goal store — owner isolation", () => {
  it("keeps the same goal id under two owners separate for read, list, write, count and delete", async () => {
    const { store, seed, peek } = createFakeGoalStore();
    seed("A", "shared", validData(1, "A-goal"));
    seed("B", "shared", validData(2, "B-goal"));

    expect((await store.get("A", "shared"))?.title).toBe("A-goal");
    expect((await store.listWindow("A")).docs.map((d) => d.data.title)).toEqual(["A-goal"]);
    expect(await store.count("B")).toBe(1);

    await store.runTransaction("A", "shared", async (tx) => {
      await tx.read();
      tx.write(goalAt(1, "A-edited"));
    });
    expect(peek("A", "shared")?.title).toBe("A-edited");
    expect(peek("B", "shared")?.title).toBe("B-goal");

    await store.delete("A", "shared");
    expect(peek("A", "shared")).toBeUndefined();
    expect(peek("B", "shared")?.title).toBe("B-goal");
    expect((await store.listWindow("B")).docs).toHaveLength(1);
    expect((await store.scanMissingCreatedAt("A")).rawCount).toBe(0);
  });

  it("refuses unsafe owner and goal path segments", async () => {
    const { store } = createFakeGoalStore();
    await expect(store.listWindow("a/b")).rejects.toThrow(InvalidGoalStoreKeyError);
    await expect(store.get("u1", "a/b")).rejects.toThrow(InvalidGoalStoreKeyError);
    await expect(store.delete("u1", "__x__")).rejects.toThrow(InvalidGoalStoreKeyError);
    await expect(store.delete("u1", "__foo__")).rejects.toThrow(InvalidGoalStoreKeyError);
    await expect(store.delete("u1", "a".repeat(129))).rejects.toThrow(InvalidGoalStoreKeyError);
    await expect(store.delete("u1", "a".repeat(128))).resolves.toBeUndefined();
  });
});

describe("fake goal store — list window ordering (BR-30)", () => {
  it("orders by createdAt descending with the implicit __name__ tie-break also descending", async () => {
    const { store, seed } = createFakeGoalStore();
    seed("u1", "b", validData(5));
    seed("u1", "a", validData(5));
    seed("u1", "c", validData(9));
    seed("u1", "z", validData(1));
    expect((await store.listWindow("u1")).docs.map((d) => d.id)).toEqual(["c", "b", "a", "z"]);
  });

  it("excludes documents whose createdAt is absent and keeps null / non-timestamp createdAt by type order", async () => {
    const { store, seed } = createFakeGoalStore();
    seed("u1", "missing", { title: "t" });
    seed("u1", "str", { ...validData(1), createdAt: "2026-01-01" });
    seed("u1", "nul", { ...validData(1), createdAt: null });
    seed("u1", "num", { ...validData(1), createdAt: 5 });
    seed("u1", "ts", validData(1));
    const result = await store.listWindow("u1");
    // descending type order: string > timestamp > number > null
    expect(result.docs.map((d) => d.id)).toEqual(["str", "ts", "num", "nul"]);
    expect(result.rawCount).toBe(4);
  });

  it("returns raw, unrepaired data with Dates standing for Timestamps and does not alias stored state", async () => {
    const { store, seed, peek } = createFakeGoalStore();
    seed("u1", "m", { ...validData(1), extra: "x", status: "weird" });
    const [doc] = (await store.listWindow("u1")).docs;
    expect(doc.data).toMatchObject({ extra: "x", status: "weird" });
    doc.data.status = "mutated";
    expect(peek("u1", "m")?.status).toBe("weird");
  });
});

describe("fake goal store — bounded window, cap support and truncation (BR-32, BR-34)", () => {
  function seedMixed(count: number) {
    const fake = createFakeGoalStore();
    for (let i = 0; i < count; i += 1) {
      // every third document is malformed with a createdAt; every fifth lacks createdAt entirely
      if (i % 5 === 0) fake.seed("u1", id(i), { title: "x" });
      else if (i % 3 === 0) fake.seed("u1", id(i), { ...validData(i), status: "bogus" });
      else fake.seed("u1", id(i), validData(i));
    }
    return fake;
  }

  it.each([
    [0, 0, 0],
    [1, 0, 1],
    [99, 99 - 20, 99],
    [100, 100 - 20, 100],
  ])("with %i mixed documents: list candidates (createdAt present) %i, count %i", async (n, listed, counted) => {
    const { store } = seedMixed(n);
    const window = await store.listWindow("u1");
    expect(window.docs).toHaveLength(listed);
    expect(window.rawCount).toBe(listed);
    expect(await store.count("u1")).toBe(counted);
  });

  it("101 documents with createdAt: window returns 100, rawCount 101, the oldest is only a probe", async () => {
    const { store, seed } = createFakeGoalStore();
    for (let i = 0; i < 101; i += 1) seed("u1", id(i), validData(i));
    const window = await store.listWindow("u1");
    expect(window.docs).toHaveLength(100);
    expect(window.rawCount).toBe(101);
    expect(window.docs.map((d) => d.id)).not.toContain(id(0));
    expect(window.docs[0].id).toBe(id(100));
  });

  it("malformed documents keep their raw slot: no refill past the window", async () => {
    const { store, seed } = createFakeGoalStore();
    for (let i = 0; i < 105; i += 1) seed("u1", id(i), i >= 90 ? { ...validData(i), status: "bogus" } : validData(i));
    const window = await store.listWindow("u1");
    expect(window.docs).toHaveLength(100);
    // 15 malformed newest + 85 valid; the 5 oldest valid documents are not pulled in.
    expect(window.docs.filter((d) => parseStoredGoal(d.data).ok)).toHaveLength(85);
    expect(window.rawCount).toBe(101);
  });

  it("count covers every document, malformed and missing-createdAt included, and is not bounded to 101", async () => {
    const { store, seed } = createFakeGoalStore();
    for (let i = 0; i < 130; i += 1) seed("u1", id(i), i % 2 ? { title: "x" } : validData(i));
    expect(await store.count("u1")).toBe(130);
  });
});

describe("fake goal store — recovery scan and eventual reachability (BR-58, BR-60)", () => {
  it("scan lists missing-createdAt ids in id order and ignores documents that have a createdAt", async () => {
    const { store, seed } = createFakeGoalStore();
    seed("u1", "b-missing", { title: "x", bogus: 1 });
    seed("u1", "a-missing", {});
    seed("u1", "c-valid", validData(1));
    seed("u1", "d-null", { createdAt: null });
    seed("u1", "e-invalid", { ...validData(1), createdAt: "never" });
    await expect(store.scanMissingCreatedAt("u1")).resolves.toEqual({
      missingCreatedAtIds: ["a-missing", "b-missing"],
      rawCount: 5,
    });
  });

  it("scan examines the first 100 ids only; the 101st is a probe", async () => {
    const { store, seed } = createFakeGoalStore();
    for (let i = 0; i < 101; i += 1) seed("u1", id(i), { title: "x" });
    const scan = await store.scanMissingCreatedAt("u1");
    expect(scan.rawCount).toBe(101);
    expect(scan.missingCreatedAtIds).toHaveLength(100);
    expect(scan.missingCreatedAtIds).not.toContain(id(100));
  });

  it("a missing-createdAt document is excluded from the list query yet counted and discoverable by the scan, and deletable", async () => {
    const { store, seed, peek } = createFakeGoalStore();
    seed("u1", "orphan", { title: "malformed" });
    expect((await store.listWindow("u1")).docs).toEqual([]);
    expect(await store.count("u1")).toBe(1);
    expect((await store.scanMissingCreatedAt("u1")).missingCreatedAtIds).toEqual(["orphan"]);
    await store.delete("u1", "orphan");
    expect(peek("u1", "orphan")).toBeUndefined();
    expect(await store.count("u1")).toBe(0);
  });

  it("an invalid createdAt document stays in the list window as raw data and is deletable", async () => {
    const { store, seed } = createFakeGoalStore();
    seed("u1", "bad", { ...validData(1), createdAt: "garbage" });
    const [doc] = (await store.listWindow("u1")).docs;
    expect(doc.id).toBe("bad");
    expect(parseStoredGoal(doc.data)).toEqual({ ok: false });
    await store.delete("u1", "bad");
    expect((await store.listWindow("u1")).docs).toEqual([]);
  });

  it("documents beyond both bounded windows become reachable after deleting shown ones and refetching", async () => {
    const { store, seed } = createFakeGoalStore();
    // 103 documents without createdAt: only the first 100 ids are discoverable at first.
    for (let i = 0; i < 103; i += 1) seed("u1", id(i), { title: "x" });
    const first = await store.scanMissingCreatedAt("u1");
    expect(first.missingCreatedAtIds).not.toContain(id(102));
    for (const goalId of first.missingCreatedAtIds.slice(0, 3)) await store.delete("u1", goalId);
    const second = await store.scanMissingCreatedAt("u1");
    expect(second.rawCount).toBe(100);
    expect(second.missingCreatedAtIds).toContain(id(102));
    expect(second.missingCreatedAtIds).toContain(id(101));
  });

  it("list-window documents beyond the first 100 become visible after deleting newer ones", async () => {
    const { store, seed } = createFakeGoalStore();
    for (let i = 0; i < 103; i += 1) seed("u1", id(i), validData(i));
    const first = await store.listWindow("u1");
    expect(first.docs.map((d) => d.id)).not.toContain(id(0));
    for (const doc of first.docs.slice(0, 3)) await store.delete("u1", doc.id);
    const second = await store.listWindow("u1");
    expect(second.rawCount).toBe(100);
    expect(second.docs.map((d) => d.id)).toContain(id(0));
  });
});

describe("fake goal store — delete without parsing and transactions (BR-29, BR-56)", () => {
  it("deletes valid, malformed, missing-createdAt and absent documents without any read", async () => {
    const { store, seed, peek, deletes, reads } = createFakeGoalStore();
    const goalId = await store.create("u1", goalAt(1));
    seed("u1", "malformed", { ...validData(1), unknown: true });
    seed("u1", "orphan", {});
    for (const target of [goalId, "malformed", "orphan", "never-existed"]) await store.delete("u1", target);
    expect(deletes.map((d) => d.goalId)).toEqual([goalId, "malformed", "orphan", "never-existed"]);
    expect(reads.count).toBe(0);
    expect(peek("u1", goalId)).toBeUndefined();
    expect(await store.count("u1")).toBe(0);
  });

  it("applies a transactional write only after the work resolves", async () => {
    const { store, seed, peek } = createFakeGoalStore();
    seed("u1", "g", validData(1, "before"));
    await expect(
      store.runTransaction("u1", "g", async (tx) => {
        await tx.read();
        tx.write(goalAt(1, "after"));
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(peek("u1", "g")?.title).toBe("before");

    await store.runTransaction("u1", "g", async (tx) => {
      await tx.read();
      tx.write(goalAt(1, "after"));
    });
    expect(peek("u1", "g")?.title).toBe("after");
  });

  it("reports an absent document to the transaction and refuses to write it (no resurrection)", async () => {
    const { store, peek } = createFakeGoalStore();
    await expect(store.runTransaction("u1", "gone", async (tx) => tx.read())).resolves.toBeUndefined();
    await expect(
      store.runTransaction("u1", "gone", async (tx) => {
        await tx.read();
        tx.write(goalAt(1));
      }),
    ).rejects.toThrow("not read as existing");
    expect(peek("u1", "gone")).toBeUndefined();
  });

  it("rejects a transaction read issued after a write, like Firestore", async () => {
    const { store, seed, peek } = createFakeGoalStore();
    seed("u1", "g", validData(1, "before"));
    await expect(
      store.runTransaction("u1", "g", async (tx) => {
        await tx.read();
        tx.write(goalAt(1, "after"));
        await tx.read();
      }),
    ).rejects.toThrow("read after write");
    expect(peek("u1", "g")?.title).toBe("before");
  });

  it("persists only the canonical keys even if the goal object carries extra properties", async () => {
    const { store, peek } = createFakeGoalStore();
    const goalId = await store.create("u1", { ...goalAt(1), ownerUid: "u1", teamId: "t" } as unknown as Goal);
    expect(Object.keys(peek("u1", goalId) ?? {}).sort()).toEqual(["createdAt", "status", "title", "updatedAt"]);
  });

  it("a transactional write replaces the document with the canonical keys, dropping removed optional fields", async () => {
    const { store, seed, peek } = createFakeGoalStore();
    seed("u1", "g", { ...validData(1), treeId: "t1", targetDate: "2026-01-02" });
    await store.runTransaction("u1", "g", async (tx) => {
      await tx.read();
      tx.write(goalAt(1));
    });
    expect(Object.keys(peek("u1", "g") ?? {}).sort()).toEqual(["createdAt", "status", "title", "updatedAt"]);
  });
});

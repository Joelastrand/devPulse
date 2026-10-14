import { afterEach, describe, expect, it, vi } from "vitest";
import { GOAL_DTO_KEYS, GOAL_PERSISTED_KEYS } from "../domain/goal-constants";
import { createFakeGoalStore } from "./fake-goal-store";
import type { GoalStore } from "./goal-store-types";
import type { RawCatalogDoc, SkillCatalogReader } from "./skill-catalog";
import { updatePersonalGoal } from "./update-personal-goal";
import type { UpdatePersonalGoalInput } from "./update-personal-goal";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const BASE = Date.UTC(2026, 0, 1);
const at = (n: number) => new Date(BASE + n * 1000);
const CREATED = at(10);
const NOW = at(20);

const active = (extra: Record<string, unknown> = {}) => ({
  title: "Mål",
  status: "active",
  createdAt: CREATED,
  updatedAt: CREATED,
  ...extra,
});
const completed = (extra: Record<string, unknown> = {}) => active({ status: "completed", completedAt: at(12), updatedAt: at(12), ...extra });

const treeData = (name: string) => ({
  name,
  nodes: [
    { nodeId: "node-0", label: "A", order: 0 },
    { nodeId: "node-1", label: "B", order: 1 },
  ],
  createdAt: at(0),
  createdBy: "admin-uid",
});

function catalog(trees: RawCatalogDoc[] = []) {
  const calls = { list: 0, get: [] as string[], many: 0 };
  const reader: SkillCatalogReader = {
    async listOrderedByCreatedAt() {
      calls.list += 1;
      return trees;
    },
    async getById(id) {
      calls.get.push(id);
      return { id, data: trees.find((t) => t.id === id)?.data };
    },
    async getManyByIds(ids) {
      calls.many += 1;
      return ids.map((id) => ({ id, data: trees.find((t) => t.id === id)?.data }));
    },
  };
  return { reader, calls };
}

/** Records every store call and every transaction write. */
function spied(fake = createFakeGoalStore()) {
  const calls: Array<[string, ...unknown[]]> = [];
  let writes = 0;
  const store = Object.fromEntries(
    (Object.keys(fake.store) as Array<keyof GoalStore>).map((name) => [
      name,
      (...args: unknown[]) => {
        calls.push([name, ...args]);
        if (name !== "runTransaction") return (fake.store[name] as (...a: unknown[]) => unknown)(...args);
        const [owner, id, work] = args as [string, string, (tx: { write(g: unknown): void }) => Promise<unknown>];
        return fake.store.runTransaction(owner, id, (tx) =>
          work({
            ...tx,
            write(goal: unknown) {
              writes += 1;
              tx.write(goal as never);
            },
          } as never),
        );
      },
    ]),
  ) as unknown as GoalStore;
  return { ...fake, store, calls, writes: () => writes, names: () => calls.map(([n]) => n) };
}

function setup(trees: RawCatalogDoc[] = [], now: () => Date = () => NOW) {
  const s = spied();
  const cat = catalog(trees);
  const update = (goalId: string, input: UpdatePersonalGoalInput, ownerUid = "u1") =>
    updatePersonalGoal(ownerUid, goalId, input, { store: s.store, catalog: cat.reader, now });
  return { ...s, cat, update };
}

const ok = (result: Awaited<ReturnType<typeof updatePersonalGoal>>) => {
  if (!result.ok) throw new Error(`expected success, got ${result.error}`);
  return result.dto;
};

afterEach(() => vi.restoreAllMocks());

describe("updatePersonalGoal — not found and ids", () => {
  it("returns goal_not_found for a missing goal with no write and no upsert", async () => {
    const s = setup();
    expect(await s.update("missing", { title: "Nytt" })).toEqual({ ok: false, error: "goal_not_found" });
    expect(s.writes()).toBe(0);
    expect(s.peek("u1", "missing")).toBeUndefined();
  });

  it.each([
    ["invalid status", active({ status: "bogus" })],
    ["invalid title", active({ title: "" })],
    ["string createdAt", active({ createdAt: "2026-01-01" })],
    ["missing createdAt", { title: "x", status: "active", updatedAt: CREATED }],
    ["unknown key", active({ uid: "u1" })],
    ["null optional", active({ treeId: null })],
    ["completed without completedAt", active({ status: "completed" })],
  ])("treats a malformed goal (%s) exactly like a missing one: no repair, no write, no detail", async (_label, data) => {
    const s = setup();
    s.seed("u1", "gm", data);
    const before = s.peek("u1", "gm");
    const result = await s.update("gm", { title: "Nytt" });
    expect(result).toEqual({ ok: false, error: "goal_not_found" });
    expect(s.peek("u1", "gm")).toEqual(before);
    expect(s.writes()).toBe(0);
  });

  it.each(["__x__", "__foo__", "a/b", ".", "..", "", " ", "x".repeat(129)])(
    "returns goal_not_found for shape-invalid id %j without touching the store",
    async (goalId) => {
      const s = setup();
      expect(await s.update(goalId, { title: "Nytt" })).toEqual({ ok: false, error: "goal_not_found" });
      expect(s.calls).toEqual([]);
    },
  );

  it.each(["_", "-", "_a", "x".repeat(128)])("lets boundary-valid id %j reach the transaction", async (goalId) => {
    const s = setup();
    s.seed("u1", goalId, active());
    expect((await s.update(goalId, { title: "Nytt" })).ok).toBe(true);
    expect(s.names()).toEqual(["runTransaction"]);
  });

  it("is scoped to the owner: the same id under another owner is untouched, and a foreign id is not found", async () => {
    const s = setup();
    s.seed("owner-a", "same", active());
    s.seed("owner-b", "same", active());
    ok(await s.update("same", { title: "Ändrad" }, "owner-a"));
    expect(s.peek("owner-a", "same")?.title).toBe("Ändrad");
    expect(s.peek("owner-b", "same")?.title).toBe("Mål");
    s.seed("owner-b", "only-b", active());
    expect(await s.update("only-b", { title: "x" }, "owner-a")).toEqual({ ok: false, error: "goal_not_found" });
    expect(s.peek("owner-b", "only-b")?.title).toBe("Mål");
  });
});

describe("updatePersonalGoal — field edits", () => {
  it("edits the title: normalised, one write, updatedAt = now, createdAt kept, exact DTO", async () => {
    const s = setup();
    s.seed("u1", "ga", active());
    const dto = ok(await s.update("ga", { title: "  Lär   mig  " }));
    expect(Object.keys(dto)).toEqual([...GOAL_DTO_KEYS]);
    expect(dto).toMatchObject({ id: "ga", title: "Lär mig", status: "active", createdAt: CREATED.toISOString(), updatedAt: NOW.toISOString(), completedAt: null });
    expect(s.writes()).toBe(1);
    const stored = s.peek("u1", "ga") ?? {};
    expect(Object.keys(stored).every((k) => (GOAL_PERSISTED_KEYS as readonly string[]).includes(k))).toBe(true);
    expect(stored.createdAt).toEqual(CREATED);
    expect(stored.updatedAt).toEqual(NOW);
  });

  it.each([[""], ["a\nb"], [5]])("rejects title %j as invalid_title with no store call", async (title) => {
    const s = setup();
    s.seed("u1", "ga", active());
    expect(await s.update("ga", { title })).toEqual({ ok: false, error: "invalid_title" });
    expect(s.calls).toEqual([]);
  });

  it("sets, keeps and clears targetDate (omitted vs null vs value), allowing past dates", async () => {
    const s = setup();
    s.seed("u1", "ga", active({ targetDate: "2030-01-01" }));
    ok(await s.update("ga", { title: "Annat" }));
    expect(s.peek("u1", "ga")?.targetDate).toBe("2030-01-01");
    ok(await s.update("ga", { targetDate: "2020-01-01" }));
    expect(s.peek("u1", "ga")?.targetDate).toBe("2020-01-01");
    const dto = ok(await s.update("ga", { targetDate: null }));
    expect(dto.targetDate).toBeNull();
    expect("targetDate" in (s.peek("u1", "ga") ?? {})).toBe(false);
  });

  it.each([["2026-02-30"], ["26-1-1"], [""]])("rejects targetDate %j as invalid_target_date with no store call", async (targetDate) => {
    const s = setup();
    s.seed("u1", "ga", active());
    expect(await s.update("ga", { targetDate })).toEqual({ ok: false, error: "invalid_target_date" });
    expect(s.calls).toEqual([]);
  });

  it("preserves completedAt on edits of a completed goal", async () => {
    const s = setup();
    s.seed("u1", "ga", completed());
    const dto = ok(await s.update("ga", { title: "Ändrad" }));
    expect(dto).toMatchObject({ status: "completed", completedAt: at(12).toISOString(), updatedAt: NOW.toISOString() });
    expect(s.peek("u1", "ga")?.completedAt).toEqual(at(12));
  });
});

describe("updatePersonalGoal — complete and reopen", () => {
  it("completes an active goal: status, completedAt = now, updatedAt = now", async () => {
    const s = setup();
    s.seed("u1", "ga", active());
    const dto = ok(await s.update("ga", { status: "completed" }));
    expect(dto).toMatchObject({ status: "completed", completedAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
    expect(s.peek("u1", "ga")).toMatchObject({ status: "completed", completedAt: NOW, updatedAt: NOW });
  });

  it("reopens a completed goal: completedAt removed from the stored document, updatedAt = now", async () => {
    const s = setup();
    s.seed("u1", "ga", completed());
    const dto = ok(await s.update("ga", { status: "active" }));
    expect(dto).toMatchObject({ status: "active", completedAt: null, updatedAt: NOW.toISOString() });
    expect("completedAt" in (s.peek("u1", "ga") ?? {})).toBe(false);
  });

  it("applies a combined {title,status} change as one write with one updatedAt", async () => {
    const s = setup([{ id: "t1", data: treeData("Testning") }]);
    s.seed("u1", "ga", active());
    const dto = ok(await s.update("ga", { title: "Klar", status: "completed", targetDate: "2027-01-01", treeId: "t1" }));
    expect(dto).toMatchObject({ title: "Klar", status: "completed", targetDate: "2027-01-01", treeId: "t1", areaName: "Testning", completedAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
    expect(s.writes()).toBe(1);
  });

  it("applies none of a combined change when one part is invalid", async () => {
    const s = setup();
    s.seed("u1", "ga", active());
    const before = s.peek("u1", "ga");
    expect(await s.update("ga", { title: "Giltig", status: "completed", targetDate: "bad" })).toEqual({ ok: false, error: "invalid_target_date" });
    expect(await s.update("ga", { title: "Giltig", status: "completed", treeId: "missing" })).toEqual({ ok: false, error: "skill_not_found" });
    expect(s.peek("u1", "ga")).toEqual(before);
    expect(s.writes()).toBe(0);
  });
});

describe("updatePersonalGoal — semantic no-op and clock", () => {
  it.each([
    ["same normalised title", active(), { title: "  Mål " }],
    ["same targetDate", active({ targetDate: "2030-01-01" }), { targetDate: "2030-01-01" }],
    ["complete an already-completed goal", completed(), { status: "completed" as const }],
    ["reopen an already-active goal", active(), { status: "active" as const }],
    ["same treeId", active({ treeId: "t1" }), { treeId: "t1" }],
    ["clear an absent treeId", active(), { treeId: null }],
  ])("%s performs no write and keeps updatedAt, even with a regressed clock", async (_label, data, input) => {
    const s = setup([{ id: "t1", data: treeData("T") }], () => at(1));
    s.seed("u1", "ga", data);
    const before = s.peek("u1", "ga");
    const dto = ok(await s.update("ga", input));
    expect(s.writes()).toBe(0);
    expect(s.peek("u1", "ga")).toEqual(before);
    expect(dto.updatedAt).toBe((data.updatedAt as Date).toISOString());
  });

  it("rejects an actual change one millisecond before createdAt as clock_regressed, with no write", async () => {
    const s = setup([], () => new Date(CREATED.getTime() - 1));
    s.seed("u1", "ga", active());
    const before = s.peek("u1", "ga");
    expect(await s.update("ga", { title: "Nytt" })).toEqual({ ok: false, error: "clock_regressed" });
    expect(s.peek("u1", "ga")).toEqual(before);
    expect(s.writes()).toBe(0);
  });

  it("rejects an actual change with an invalid clock as clock_regressed, not persistence_failed", async () => {
    const s = setup([], () => new Date(Number.NaN));
    s.seed("u1", "ga", active());
    expect(await s.update("ga", { status: "completed" })).toEqual({ ok: false, error: "clock_regressed" });
    expect(s.writes()).toBe(0);
  });

  it("allows an actual change when now equals createdAt", async () => {
    const s = setup([], () => new Date(CREATED.getTime()));
    s.seed("u1", "ga", active());
    const dto = ok(await s.update("ga", { title: "Nytt" }));
    expect(dto.updatedAt).toBe(CREATED.toISOString());
    expect(s.writes()).toBe(1);
  });
});

describe("updatePersonalGoal — SkillTree handling", () => {
  it("does not validate an unchanged treeId, and saves unrelated edits when that tree is now missing", async () => {
    const s = setup();
    s.seed("u1", "ga", active({ treeId: "gone" }));
    ok(await s.update("ga", { title: "Annat" }));
    const dto = ok(await s.update("ga", { treeId: "gone", targetDate: "2030-01-01" }));
    expect(dto).toMatchObject({ treeId: "gone", areaName: null, areaAvailable: false, targetDate: "2030-01-01" });
    expect(s.peek("u1", "ga")).toMatchObject({ treeId: "gone", targetDate: "2030-01-01" });
  });

  it("reports the current name of an unchanged available tree without selector use", async () => {
    const s = setup([{ id: "t1", data: treeData("Testning") }]);
    s.seed("u1", "ga", active({ treeId: "t1" }));
    const dto = ok(await s.update("ga", { title: "Annat" }));
    expect(dto).toMatchObject({ treeId: "t1", areaName: "Testning", areaAvailable: true });
    expect(s.cat.calls.list).toBe(0);
  });

  it("validates a changed tree directly and reuses its name, even outside any selector window", async () => {
    const trees = Array.from({ length: 520 }, (_, i) => ({ id: `t${i}`, data: treeData(`Tree ${i}`) }));
    const s = setup(trees);
    s.seed("u1", "ga", active({ treeId: "t1" }));
    const dto = ok(await s.update("ga", { treeId: "t515" }));
    expect(dto).toMatchObject({ treeId: "t515", areaName: "Tree 515", areaAvailable: true });
    expect(s.cat.calls).toEqual({ list: 0, get: ["t515"], many: 0 });
    expect(s.peek("u1", "ga")?.treeId).toBe("t515");
  });

  it.each([
    ["missing", []],
    ["malformed", [{ id: "tx", data: { name: "LEAKED", nodes: "x" } }]],
  ])("rejects a changed %s tree as skill_not_found with no write", async (_label, trees) => {
    const s = setup(trees);
    s.seed("u1", "ga", active({ treeId: "t1" }));
    const result = await s.update("ga", { treeId: "tx", title: "Nytt" });
    expect(result).toEqual({ ok: false, error: "skill_not_found" });
    expect(JSON.stringify(result)).not.toContain("LEAKED");
    expect(s.writes()).toBe(0);
    expect(s.peek("u1", "ga")?.title).toBe("Mål");
  });

  it("rejects an empty changed treeId as skill_not_found", async () => {
    const s = setup();
    s.seed("u1", "ga", active());
    expect(await s.update("ga", { treeId: "" })).toEqual({ ok: false, error: "skill_not_found" });
  });

  it("maps a catalog read failure on a changed tree to persistence_failed with no write", async () => {
    const s = setup();
    s.seed("u1", "ga", active());
    const catalogReader: SkillCatalogReader = { ...s.cat.reader, getById: () => Promise.reject(new Error("secret internal")) };
    const result = await updatePersonalGoal("u1", "ga", { treeId: "t1" }, { store: s.store, catalog: catalogReader, now: () => NOW });
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(s.writes()).toBe(0);
  });

  it("clears treeId with null without any catalog read, removing the key from the stored document", async () => {
    const s = setup();
    s.seed("u1", "ga", active({ treeId: "gone" }));
    const dto = ok(await s.update("ga", { treeId: null }));
    expect(dto).toMatchObject({ treeId: null, areaName: null, areaAvailable: true });
    expect("treeId" in (s.peek("u1", "ga") ?? {})).toBe(false);
    expect(s.cat.calls).toEqual({ list: 0, get: [], many: 0 });
  });

  it("does not read the catalog for a goal without a tree", async () => {
    const s = setup();
    s.seed("u1", "ga", active());
    expect(ok(await s.update("ga", { title: "Nytt" }))).toMatchObject({ treeId: null, areaName: null, areaAvailable: true });
    expect(s.cat.calls).toEqual({ list: 0, get: [], many: 0 });
  });
});

describe("updatePersonalGoal — transactions and boundaries", () => {
  it("applies two concurrent edits of different fields when the transaction is retried", async () => {
    const fake = createFakeGoalStore();
    fake.seed("u1", "ga", active());
    let attempts = 0;
    const store: GoalStore = {
      ...fake.store,
      // First attempt reads stale data, then another request changes targetDate before the retry.
      runTransaction: async (owner, id, work) => {
        attempts += 1;
        if (attempts === 1) {
          await work({ read: async () => fake.peek(owner, id), write: () => undefined });
          fake.seed("u1", "ga", active({ targetDate: "2031-01-01", updatedAt: at(15) }));
        }
        return fake.store.runTransaction(owner, id, work);
      },
    };
    const deps = { store, catalog: catalog().reader, now: () => NOW };
    ok(await updatePersonalGoal("u1", "ga", { title: "Ny titel" }, deps));
    expect(attempts).toBe(1);
    expect(fake.peek("u1", "ga")).toMatchObject({ title: "Ny titel", targetDate: "2031-01-01", updatedAt: NOW });
  });

  it("maps a transaction failure to persistence_failed without detail or logging", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m));
    const store: GoalStore = { ...createFakeGoalStore().store, runTransaction: () => Promise.reject(new Error("secret internal")) };
    const result = await updatePersonalGoal("u1", "ga", { title: "Hemlig" }, { store, catalog: catalog().reader, now: () => NOW });
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("secret");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("uses only the transaction: no count, list, scan, create, delete or get", async () => {
    const s = setup();
    s.seed("u1", "ga", active());
    s.seed("u1", "gm", { title: "x" });
    ok(await s.update("ga", { title: "Nytt" }));
    await s.update("gm", { title: "Nytt" });
    await s.update("nope", { title: "Nytt" });
    expect(new Set(s.names())).toEqual(new Set(["runTransaction"]));
    expect(s.deletes).toEqual([]);
  });
});

describe("updatePersonalGoal — response area resolution (BR-40, BR-39)", () => {
  const failingTreeRead = (s: ReturnType<typeof setup>): SkillCatalogReader => ({
    ...s.cat.reader,
    getById: () => Promise.reject(new Error("secret internal")),
  });

  it("a no-op on a goal with an available tree writes nothing and reports the current name", async () => {
    const s = setup([{ id: "t1", data: treeData("Testning") }], () => at(1));
    s.seed("u1", "ga", active({ treeId: "t1" }));
    const dto = ok(await s.update("ga", { title: "Mål" }));
    expect(dto).toMatchObject({ treeId: "t1", areaName: "Testning", areaAvailable: true });
    expect(s.writes()).toBe(0);
  });

  it("a no-op on a goal whose tree is now missing reports the neutral unavailable state", async () => {
    const s = setup();
    s.seed("u1", "ga", active({ treeId: "gone" }));
    const dto = ok(await s.update("ga", { title: "Mål" }));
    expect(dto).toMatchObject({ treeId: "gone", areaName: null, areaAvailable: false });
    expect(s.writes()).toBe(0);
  });

  it("a no-op with a catalog read failure is persistence_failed (nothing was written)", async () => {
    const s = setup();
    s.seed("u1", "ga", active({ treeId: "t1" }));
    const result = await updatePersonalGoal("u1", "ga", { title: "Mål" }, { store: s.store, catalog: failingTreeRead(s), now: () => NOW });
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(s.writes()).toBe(0);
  });

  it("a response-area read failure after a committed change is persistence_failed, the change stays persisted, and a retry is an idempotent no-op", async () => {
    const s = setup([{ id: "t1", data: treeData("Testning") }]);
    s.seed("u1", "ga", active({ treeId: "t1" }));
    const failed = await updatePersonalGoal("u1", "ga", { title: "Ny titel" }, { store: s.store, catalog: failingTreeRead(s), now: () => NOW });
    expect(failed).toEqual({ ok: false, error: "persistence_failed" });
    expect(s.writes()).toBe(1);
    expect(s.peek("u1", "ga")).toMatchObject({ title: "Ny titel", updatedAt: NOW });
    const retry = ok(await s.update("ga", { title: "Ny titel" }));
    expect(s.writes()).toBe(1);
    expect(retry).toMatchObject({ title: "Ny titel", updatedAt: NOW.toISOString(), areaName: "Testning" });
  });

  it("a changed-tree validation failure writes nothing, unlike a post-commit area read failure", async () => {
    const s = setup();
    s.seed("u1", "ga", active());
    const result = await updatePersonalGoal("u1", "ga", { treeId: "t1", title: "Nytt" }, { store: s.store, catalog: failingTreeRead(s), now: () => NOW });
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(s.writes()).toBe(0);
    expect(s.peek("u1", "ga")?.title).toBe("Mål");
  });
});

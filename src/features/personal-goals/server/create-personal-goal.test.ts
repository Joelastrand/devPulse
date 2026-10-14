import { afterEach, describe, expect, it, vi } from "vitest";
import { GOAL_DTO_KEYS, GOAL_PERSISTED_KEYS } from "../domain/goal-constants";
import { createPersonalGoal } from "./create-personal-goal";
import { deletePersonalGoal } from "./delete-personal-goal";
import { createFakeGoalStore } from "./fake-goal-store";
import type { GoalStore } from "./goal-store-types";
import { getPersonalGoals } from "./get-personal-goals";
import type { RawCatalogDoc, SkillCatalogReader } from "./skill-catalog";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const NOW = new Date("2026-03-04T05:06:07.000Z");
const BASE = Date.UTC(2026, 0, 1);
const at = (n: number) => new Date(BASE + n * 1000);
const gid = (n: number) => `g${String(n).padStart(4, "0")}`;
const goalData = (n: number) => ({ title: `Mål ${n}`, status: "active", createdAt: at(n), updatedAt: at(n) });
const treeData = (name: string) => ({
  name,
  nodes: [
    { nodeId: "node-0", label: "A", order: 0 },
    { nodeId: "node-1", label: "B", order: 1 },
  ],
  createdAt: at(0),
  createdBy: "admin-uid",
});

/** Catalog double; the selector list must never be used by create. */
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

/** Wraps the fake store so every call is recorded with its arguments. */
function spied(fake = createFakeGoalStore()) {
  const calls: Array<[string, ...unknown[]]> = [];
  const store = Object.fromEntries(
    (Object.keys(fake.store) as Array<keyof GoalStore>).map((name) => [
      name,
      (...args: unknown[]) => {
        calls.push([name, ...args]);
        return (fake.store[name] as (...a: unknown[]) => unknown)(...args);
      },
    ]),
  ) as unknown as GoalStore;
  return { ...fake, store, calls, names: () => calls.map(([n]) => n) };
}

function setup(trees: RawCatalogDoc[] = []) {
  const s = spied();
  const cat = catalog(trees);
  const create = (input: Parameters<typeof createPersonalGoal>[1], ownerUid = "u1") =>
    createPersonalGoal(ownerUid, input, { store: s.store, catalog: cat.reader, now: () => NOW });
  return { ...s, cat, create };
}

afterEach(() => vi.restoreAllMocks());

describe("createPersonalGoal — success", () => {
  it("creates a minimal goal: canonical keys, createdAt == updatedAt == now, no catalog call, one count, one create", async () => {
    const s = setup();
    const result = await s.create({ title: "  Lær   Rust " });
    if (!result.ok) throw new Error("expected success");
    expect(s.names()).toEqual(["count", "create"]);
    expect(s.cat.calls).toEqual({ list: 0, get: [], many: 0 });
    expect(Object.keys(result.dto)).toEqual([...GOAL_DTO_KEYS]);
    expect(result.dto).toEqual({
      id: result.dto.id,
      title: "Lær Rust",
      status: "active",
      treeId: null,
      areaName: null,
      areaAvailable: true,
      targetDate: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      completedAt: null,
    });
    const stored = s.peek("u1", result.dto.id) ?? {};
    expect(Object.keys(stored).sort()).toEqual(["createdAt", "status", "title", "updatedAt"]);
    expect(stored.createdAt).toEqual(NOW);
    expect(stored.updatedAt).toEqual(NOW);
  });

  it("creates a full goal with a direct tree read and no selector use", async () => {
    const s = setup([{ id: "t1", data: treeData("Testning") }]);
    const result = await s.create({ title: "é mål", treeId: "t1", targetDate: "2020-01-31" });
    if (!result.ok) throw new Error("expected success");
    expect(result.dto).toMatchObject({ title: "é mål", treeId: "t1", areaName: "Testning", areaAvailable: true, targetDate: "2020-01-31" });
    expect(s.cat.calls).toEqual({ list: 0, get: ["t1"], many: 0 });
    const stored = s.peek("u1", result.dto.id) ?? {};
    for (const key of Object.keys(stored)) expect(GOAL_PERSISTED_KEYS as readonly string[]).toContain(key);
    expect(stored).toMatchObject({ treeId: "t1", targetDate: "2020-01-31" });
    expect(JSON.stringify(result)).not.toContain("admin-uid");
  });

  it("accepts a valid tree that no selector window would offer", async () => {
    const trees = Array.from({ length: 520 }, (_, i) => ({ id: `t${i}`, data: treeData(`Tree ${i}`) }));
    const s = setup(trees);
    const result = await s.create({ title: "Mål", treeId: "t515" });
    expect(result.ok && result.dto.areaName).toBe("Tree 515");
    expect(s.cat.calls.list).toBe(0);
  });
});

describe("createPersonalGoal — validation and ordering", () => {
  it.each([[""], ["   "], ["a\nb"], [123], [undefined]])("rejects title %j as invalid_title before any call", async (title) => {
    const s = setup();
    expect(await s.create({ title })).toEqual({ ok: false, error: "invalid_title" });
    expect(s.calls).toEqual([]);
    expect(s.cat.calls.get).toEqual([]);
  });

  it.each([["2026-13-01"], ["2026-1-1"], [""]])("rejects targetDate %j as invalid_target_date before any call", async (targetDate) => {
    const s = setup();
    expect(await s.create({ title: "Mål", targetDate, treeId: "t1" })).toEqual({ ok: false, error: "invalid_target_date" });
    expect(s.calls).toEqual([]);
    expect(s.cat.calls.get).toEqual([]);
  });

  it("reports the title error before the date error", async () => {
    const s = setup();
    expect(await s.create({ title: "", targetDate: "bad" })).toEqual({ ok: false, error: "invalid_title" });
  });

  it.each([
    ["missing", []],
    ["malformed", [{ id: "t1", data: { name: "LEAKED", nodes: "x" } }]],
  ])("rejects a %s tree as skill_not_found without count or create", async (_label, trees) => {
    const s = setup(trees);
    const result = await s.create({ title: "Mål", treeId: "t1" });
    expect(result).toEqual({ ok: false, error: "skill_not_found" });
    expect(JSON.stringify(result)).not.toContain("LEAKED");
    expect(s.calls).toEqual([]);
  });

  it("treats an empty or unreadable tree id as skill_not_found without a store call", async () => {
    const s = setup();
    for (const treeId of ["", "a/b"]) expect(await s.create({ title: "Mål", treeId })).toEqual({ ok: false, error: "skill_not_found" });
    expect(s.calls).toEqual([]);
  });

  it("checks the tree before the cap: an unknown tree at the cap is skill_not_found", async () => {
    const s = setup();
    for (let i = 0; i < 100; i += 1) s.seed("u1", gid(i), goalData(i));
    expect(await s.create({ title: "Mål", treeId: "missing" })).toEqual({ ok: false, error: "skill_not_found" });
    expect(s.names()).toEqual([]);
  });
});

describe("createPersonalGoal — cap (count-then-create, non-transactional)", () => {
  it.each([
    [0, true],
    [99, true],
    [100, false],
    [101, false],
  ])("with %i existing documents create ok=%s", async (existing, ok) => {
    const s = setup();
    for (let i = 0; i < existing; i += 1) s.seed("u1", gid(i), goalData(i));
    const result = await s.create({ title: "Mål" });
    expect(result.ok).toBe(ok);
    if (!ok) expect(result).toEqual({ ok: false, error: "goal_limit" });
    expect(s.names()).toEqual(ok ? ["count", "create"] : ["count"]);
  });

  it("counts malformed and missing-createdAt documents toward the cap, not just valid goals", async () => {
    const s = setup();
    for (let i = 0; i < 98; i += 1) s.seed("u1", gid(i), goalData(i));
    s.seed("u1", "gbad", { title: "x", status: "bogus", createdAt: at(1) });
    s.seed("u1", "gnone", { title: "x" });
    expect(await s.create({ title: "Mål" })).toEqual({ ok: false, error: "goal_limit" });
  });

  it("counts a non-addressable stored document toward the cap (BR-63)", async () => {
    const s = setup();
    for (let i = 0; i < 99; i += 1) s.seed("u1", gid(i), goalData(i));
    s.seed("u1", "bad/id", goalData(500));
    expect(await s.create({ title: "Mål" })).toEqual({ ok: false, error: "goal_limit" });
    expect(s.names()).toEqual(["count"]);
  });

  it("counts only the requesting owner's documents", async () => {
    const s = setup();
    for (let i = 0; i < 100; i += 1) s.seed("u2", gid(i), goalData(i));
    expect((await s.create({ title: "Mål" })).ok).toBe(true);
  });

  it("does not claim strictness: two creates that both observed 99 both succeed, with no transaction or lock", async () => {
    const fake = spied();
    for (let i = 0; i < 99; i += 1) fake.seed("u1", gid(i), goalData(i));
    const gate = Promise.withResolvers<void>();
    const slowCount = fake.store.count.bind(fake.store);
    const store: GoalStore = {
      ...fake.store,
      count: async (owner) => {
        const n = await slowCount(owner);
        await gate.promise;
        return n;
      },
    };
    const deps = { store, catalog: catalog().reader, now: () => NOW };
    const both = Promise.all([createPersonalGoal("u1", { title: "A" }, deps), createPersonalGoal("u1", { title: "B" }, deps)]);
    await Promise.resolve();
    gate.resolve();
    const results = await both;
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(await fake.store.count("u1")).toBe(101);
    expect(fake.names()).not.toContain("runTransaction");
  });

  it("recovery deletion frees capacity: goal_limit, delete a recovery item, then create succeeds", async () => {
    const s = setup();
    for (let i = 0; i < 99; i += 1) s.seed("u1", gid(i), goalData(i));
    s.seed("u1", "gnone", { title: "x" });
    expect(await s.create({ title: "Mål" })).toEqual({ ok: false, error: "goal_limit" });
    const listed = await getPersonalGoals("u1", { store: s.store, catalog: s.cat.reader });
    expect(listed.ok && listed.dto.recoveryItems).toEqual([{ goalId: "gnone" }]);
    expect(await deletePersonalGoal("u1", "gnone", { store: s.store })).toEqual({ ok: true });
    expect((await s.create({ title: "Mål" })).ok).toBe(true);
  });
});

describe("createPersonalGoal — persistence failures and boundaries", () => {
  const rejecting = (method: keyof GoalStore, base: GoalStore): GoalStore => ({
    ...base,
    [method]: () => Promise.reject(new Error("secret internal")),
  });

  it("maps a count failure to persistence_failed with no create", async () => {
    const s = setup();
    const create = vi.fn(s.store.create);
    const store = { ...rejecting("count", s.store), create };
    const result = await createPersonalGoal("u1", { title: "Mål" }, { store, catalog: s.cat.reader, now: () => NOW });
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(create).not.toHaveBeenCalled();
  });

  it("maps a create failure to persistence_failed with no detail", async () => {
    const s = setup();
    const store = rejecting("create", s.store);
    const result = await createPersonalGoal("u1", { title: "Mål" }, { store, catalog: s.cat.reader, now: () => NOW });
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("maps a tree read failure to persistence_failed, not skill_not_found, with no count or create", async () => {
    const s = setup();
    const reader: SkillCatalogReader = { ...s.cat.reader, getById: () => Promise.reject(new Error("secret internal")) };
    const result = await createPersonalGoal("u1", { title: "Mål", treeId: "t1" }, { store: s.store, catalog: reader, now: () => NOW });
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(s.calls).toEqual([]);
  });

  it("never logs content or raw errors", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m));
    const s = setup();
    await createPersonalGoal("u1", { title: "Hemlig" }, { store: rejecting("create", s.store), catalog: s.cat.reader, now: () => NOW });
    await s.create({ title: "" });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("persists under the supplied owner only", async () => {
    const s = setup();
    const result = await s.create({ title: "Mål" }, "owner-a");
    if (!result.ok) throw new Error("expected success");
    expect(s.peek("owner-a", result.dto.id)).toBeDefined();
    expect(s.peek("owner-b", result.dto.id)).toBeUndefined();
    expect(s.calls.map(([n, owner]) => [n, owner])).toEqual([
      ["count", "owner-a"],
      ["create", "owner-a"],
    ]);
  });
});

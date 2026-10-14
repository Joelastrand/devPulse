import { afterEach, describe, expect, it, vi } from "vitest";
import { GOAL_DTO_KEYS, GOAL_LIST_RESPONSE_KEYS } from "../domain/goal-constants";
import { createFakeGoalStore } from "./fake-goal-store";
import type { GoalStore } from "./goal-store-types";
import { getPersonalGoals } from "./get-personal-goals";
import type { RawCatalogDoc, RawTreeRead, SkillCatalogReader } from "./skill-catalog";

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
const gid = (n: number) => `g${String(n).padStart(4, "0")}`;
const goalData = (n: number, extra: Record<string, unknown> = {}) => ({
  title: `Mål ${n}`,
  status: "active",
  createdAt: at(n),
  updatedAt: at(n),
  ...extra,
});
const malformedData = (n: number) => ({ title: "LEAKED-TITLE", status: "bogus", treeId: "LEAKED-TREE", createdAt: at(n) });

const treeData = (name: string) => ({
  name,
  nodes: [
    { nodeId: "node-0", label: "A", order: 0 },
    { nodeId: "node-1", label: "B", order: 1 },
  ],
  createdAt: at(0),
  createdBy: "admin-uid",
});

function catalog(trees: RawCatalogDoc[]) {
  const calls = { list: 0, get: 0, many: [] as string[][] };
  const find = (id: string): RawTreeRead => ({ id, data: trees.find((t) => t.id === id)?.data });
  const reader: SkillCatalogReader = {
    async listOrderedByCreatedAt(limit) {
      calls.list += 1;
      return trees.slice(0, limit);
    },
    async getById(id) {
      calls.get += 1;
      return find(id);
    },
    async getManyByIds(ids) {
      calls.many.push([...ids]);
      return ids.map(find);
    },
  };
  return { reader, calls };
}

function setup(trees: RawCatalogDoc[] = []) {
  const fake = createFakeGoalStore();
  const cat = catalog(trees);
  return { ...fake, ...cat, run: () => getPersonalGoals("u1", { store: fake.store, catalog: cat.reader }) };
}

const dtoOf = async (run: () => ReturnType<typeof getPersonalGoals>) => {
  const result = await run();
  if (!result.ok) throw new Error("expected success");
  return result.dto;
};

afterEach(() => vi.restoreAllMocks());

describe("getPersonalGoals — envelope and DTOs", () => {
  it("returns the exact empty envelope and makes no direct tree read", async () => {
    const s = setup();
    expect(await s.run()).toEqual({
      ok: true,
      dto: { goals: [], recoveryItems: [], truncated: false, skillOptions: [], skillOptionsTruncated: false },
    });
    expect(s.calls.many).toEqual([]);
  });

  it("returns valid goals as exact DTOs, newest first with id tie-break, without regrouping by status", async () => {
    const s = setup([{ id: "t1", data: treeData("Testning") }]);
    s.seed("u1", "gb", goalData(5));
    s.seed("u1", "ga", goalData(5, { treeId: "t1", targetDate: "2026-12-31" }));
    s.seed("u1", "gc", goalData(9, { status: "completed", completedAt: at(10), updatedAt: at(10) }));
    s.seed("u1", "gd", goalData(1));
    const dto = await dtoOf(s.run);
    expect(dto.goals.map((g) => g.id)).toEqual(["gc", "ga", "gb", "gd"]);
    expect(Object.keys(dto)).toEqual([...GOAL_LIST_RESPONSE_KEYS]);
    for (const goal of dto.goals) expect(Object.keys(goal)).toEqual([...GOAL_DTO_KEYS]);
    expect(dto.goals[1]).toEqual({
      id: "ga",
      title: "Mål 5",
      status: "active",
      treeId: "t1",
      areaName: "Testning",
      areaAvailable: true,
      targetDate: "2026-12-31",
      createdAt: at(5).toISOString(),
      updatedAt: at(5).toISOString(),
      completedAt: null,
    });
    expect(dto.goals[0]).toMatchObject({
      status: "completed",
      completedAt: at(10).toISOString(),
      treeId: null,
      areaName: null,
      areaAvailable: true,
    });
    expect(dto.skillOptions).toEqual([{ treeId: "t1", name: "Testning" }]);
  });

  it("contains no owner, team, raw-timestamp or tree-internal keys anywhere in the result", async () => {
    const s = setup([{ id: "t1", data: treeData("T") }]);
    s.seed("u1", "ga", goalData(1, { treeId: "t1" }));
    s.seed("u1", "gm", malformedData(2));
    const forbidden = new Set(["uid", "ownerUid", "email", "teamId", "memberRef", "nodes", "createdBy", "reason", "error"]);
    const found: string[] = [];
    const walk = (value: unknown): void => {
      if (value instanceof Date) found.push("<Date>");
      else if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === "object" && value !== null) {
        for (const [key, child] of Object.entries(value)) {
          if (forbidden.has(key)) found.push(key);
          walk(child);
        }
      }
    };
    walk(await dtoOf(s.run));
    expect(found).toEqual([]);
  });
});

describe("getPersonalGoals — recovery", () => {
  it("reports a malformed window goal once as {goalId}, never as a goal, without resolving its raw treeId", async () => {
    const s = setup();
    s.seed("u1", "ga", goalData(1));
    s.seed("u1", "gm", malformedData(2));
    const dto = await dtoOf(s.run);
    expect(dto.goals.map((g) => g.id)).toEqual(["ga"]);
    expect(dto.recoveryItems).toEqual([{ goalId: "gm" }]);
    expect(JSON.stringify(dto)).not.toContain("LEAKED");
    expect(s.calls.many).toEqual([]);
    expect(s.reads.count).toBe(0);
  });

  it("turns a string-typed createdAt into a recovery item", async () => {
    const s = setup();
    s.seed("u1", "gs", goalData(1, { createdAt: "2026-01-01" }));
    expect((await dtoOf(s.run)).recoveryItems).toEqual([{ goalId: "gs" }]);
  });

  it("finds a document without createdAt only through the scan, as a bare id with no follow-up read", async () => {
    const s = setup();
    s.seed("u1", "gn", { title: "LEAKED-TITLE", treeId: "LEAKED-TREE" });
    s.seed("u1", "ga", goalData(1));
    const dto = await dtoOf(s.run);
    expect(dto.recoveryItems).toEqual([{ goalId: "gn" }]);
    expect(dto.goals.map((g) => g.id)).toEqual(["ga"]);
    expect(Object.keys(dto.recoveryItems[0])).toEqual(["goalId"]);
    expect(JSON.stringify(dto)).not.toContain("LEAKED");
    expect(s.reads.count).toBe(0);
    expect(s.calls.many).toEqual([]);
    expect(s.calls.get).toBe(0);
  });

  it("orders recovery items by goalId regardless of content or source, and drops non-addressable ids", async () => {
    const s = setup();
    s.seed("u1", "gz", malformedData(1));
    s.seed("u1", "gb", { title: "x" });
    s.seed("u1", "ga", malformedData(9));
    s.seed("u1", "bad/id", malformedData(3));
    s.seed("u1", "has space", { title: "x" });
    s.seed("u1", "__x__", malformedData(4));
    expect((await dtoOf(s.run)).recoveryItems).toEqual([{ goalId: "ga" }, { goalId: "gb" }, { goalId: "gz" }]);
  });

  it("deduplicates ids across the non-atomic reads, with a valid goal taking precedence over a recovery item", async () => {
    const fake = createFakeGoalStore();
    fake.seed("u1", "ga", goalData(1));
    fake.seed("u1", "gm", malformedData(2));
    const store: GoalStore = {
      ...fake.store,
      scanMissingCreatedAt: async () => ({ missingCreatedAtIds: ["gm", "ga", "gm", "gx"], rawCount: 4 }),
    };
    const result = await getPersonalGoals("u1", { store, catalog: catalog([]).reader });
    expect(result.ok && result.dto.goals.map((g) => g.id)).toEqual(["ga"]);
    expect(result.ok && result.dto.recoveryItems).toEqual([{ goalId: "gm" }, { goalId: "gx" }]);
  });
});

describe("getPersonalGoals — truncation", () => {
  it("101 raw with 3 malformed: 97 goals, 3 recovery, truncated, no refill", async () => {
    const s = setup();
    for (let i = 0; i < 101; i += 1) s.seed("u1", gid(i), i < 3 ? malformedData(1000 - i) : goalData(1000 - i));
    const dto = await dtoOf(s.run);
    expect(dto.goals).toHaveLength(97);
    expect(dto.recoveryItems).toHaveLength(3);
    expect(dto.truncated).toBe(true);
  });

  it("100 raw with 3 malformed: 97 goals, not truncated", async () => {
    const s = setup();
    for (let i = 0; i < 100; i += 1) s.seed("u1", gid(i), i < 3 ? malformedData(1000 - i) : goalData(1000 - i));
    const dto = await dtoOf(s.run);
    expect(dto.goals).toHaveLength(97);
    expect(dto.truncated).toBe(false);
  });

  it("100 documents of which 2 lack createdAt: not truncated, both recovered", async () => {
    const s = setup();
    for (let i = 0; i < 100; i += 1) s.seed("u1", gid(i), i < 2 ? { title: "x" } : goalData(i));
    const dto = await dtoOf(s.run);
    expect(dto.recoveryItems).toEqual([{ goalId: gid(0) }, { goalId: gid(1) }]);
    expect(dto.truncated).toBe(false);
  });

  it("103 documents all lacking createdAt: scan overflow truncates; only the first 100 ids are recovered", async () => {
    const s = setup();
    for (let i = 0; i < 103; i += 1) s.seed("u1", gid(i), { title: "x" });
    const dto = await dtoOf(s.run);
    expect(dto.goals).toEqual([]);
    expect(dto.recoveryItems).toHaveLength(100);
    expect(dto.truncated).toBe(true);
  });

  it("scan overflow alone truncates even when the list window is small", async () => {
    const fake = createFakeGoalStore();
    for (let i = 0; i < 5; i += 1) fake.seed("u1", gid(i), goalData(i));
    const store: GoalStore = { ...fake.store, scanMissingCreatedAt: async () => ({ missingCreatedAtIds: [], rawCount: 101 }) };
    const result = await getPersonalGoals("u1", { store, catalog: catalog([]).reader });
    expect(result.ok && result.dto.truncated).toBe(true);
  });
});

describe("getPersonalGoals — SkillTree integration", () => {
  const trees = (count: number): RawCatalogDoc[] =>
    Array.from({ length: count }, (_, i) => ({ id: `t${i}`, data: treeData(`Tree ${i}`) }));

  it("resolves a stored tree outside the selector window directly; selector truncation is independent of goal truncation", async () => {
    const s = setup(trees(520));
    s.seed("u1", "ga", goalData(1, { treeId: "t510" }));
    const dto = await dtoOf(s.run);
    expect(dto.skillOptions).toHaveLength(500);
    expect(dto.skillOptions.some((o) => o.treeId === "t510")).toBe(false);
    expect(dto.skillOptionsTruncated).toBe(true);
    expect(dto.truncated).toBe(false);
    expect(dto.goals[0]).toMatchObject({ treeId: "t510", areaName: "Tree 510", areaAvailable: true });
  });

  it("reports goal truncation while the selector is not truncated", async () => {
    const s = setup(trees(2));
    for (let i = 0; i < 101; i += 1) s.seed("u1", gid(i), goalData(i));
    const dto = await dtoOf(s.run);
    expect(dto.truncated).toBe(true);
    expect(dto.skillOptionsTruncated).toBe(false);
  });

  it("keeps goals whose tree is missing or malformed with the neutral unavailable representation", async () => {
    const s = setup([{ id: "tbad", data: { name: "LEAKED-NAME", nodes: "x" } }]);
    s.seed("u1", "ga", goalData(1, { treeId: "missing" }));
    s.seed("u1", "gb", goalData(2, { treeId: "tbad" }));
    const dto = await dtoOf(s.run);
    expect(dto.goals).toHaveLength(2);
    for (const goal of dto.goals) expect(goal).toMatchObject({ areaName: null, areaAvailable: false });
    expect(dto.goals.map((g) => g.treeId).sort()).toEqual(["missing", "tbad"]);
    expect(JSON.stringify(dto)).not.toContain("LEAKED");
  });

  it("resolves duplicate tree ids with one deduplicated batch call, no per-goal read, and no malformed-goal tree id", async () => {
    const s = setup([
      { id: "t1", data: treeData("Delad") },
      { id: "t2", data: treeData("Två") },
    ]);
    s.seed("u1", "ga", goalData(1, { treeId: "t1" }));
    s.seed("u1", "gb", goalData(2, { treeId: "t1" }));
    s.seed("u1", "gc", goalData(3, { treeId: "t2" }));
    s.seed("u1", "gd", goalData(4));
    s.seed("u1", "gm", malformedData(5));
    const dto = await dtoOf(s.run);
    expect(s.calls.many).toEqual([["t2", "t1"]]);
    expect(s.calls.get).toBe(0);
    expect(dto.goals.filter((g) => g.treeId === "t1").map((g) => g.areaName)).toEqual(["Delad", "Delad"]);
  });

  it("does not resolve trees when no visible goal has one, but still reads the selector", async () => {
    const s = setup(trees(1));
    s.seed("u1", "ga", goalData(1));
    await dtoOf(s.run);
    expect(s.calls.many).toEqual([]);
    expect(s.calls.list).toBe(1);
  });
});

describe("getPersonalGoals — failures and boundaries", () => {
  it.each(["listWindow", "scanMissingCreatedAt"] as const)("maps a %s failure to persistence_failed with no detail", async (method) => {
    const fake = createFakeGoalStore();
    const store: GoalStore = { ...fake.store, [method]: () => Promise.reject(new Error("secret internal")) };
    expect(await getPersonalGoals("u1", { store, catalog: catalog([]).reader })).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("maps a selector read failure to persistence_failed, not an empty catalog", async () => {
    const fake = createFakeGoalStore();
    const reader: SkillCatalogReader = {
      ...catalog([]).reader,
      listOrderedByCreatedAt: () => Promise.reject(new Error("secret internal")),
    };
    expect(await getPersonalGoals("u1", { store: fake.store, catalog: reader })).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("maps a name-resolution failure to persistence_failed, not an unavailable tree", async () => {
    const fake = createFakeGoalStore();
    fake.seed("u1", "ga", goalData(1, { treeId: "t1" }));
    const reader: SkillCatalogReader = {
      ...catalog([]).reader,
      getManyByIds: () => Promise.reject(new Error("secret internal")),
    };
    expect(await getPersonalGoals("u1", { store: fake.store, catalog: reader })).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("is read-only: no count, create, delete, transaction or get, and no logging", async () => {
    const fake = createFakeGoalStore();
    fake.seed("u1", "ga", goalData(1));
    fake.seed("u1", "gm", malformedData(2));
    const guarded = new Proxy(fake.store, {
      get: (target, prop: keyof GoalStore) => {
        if (["count", "create", "delete", "runTransaction", "get"].includes(prop)) throw new Error(`unexpected store.${prop}`);
        return target[prop];
      },
    });
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m));
    expect((await getPersonalGoals("u1", { store: guarded, catalog: catalog([]).reader })).ok).toBe(true);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("passes the same verified ownerUid to both store reads and none to the catalog", async () => {
    const fake = createFakeGoalStore();
    const listWindow = vi.fn(fake.store.listWindow);
    const scanMissingCreatedAt = vi.fn(fake.store.scanMissingCreatedAt);
    const store: GoalStore = { ...fake.store, listWindow, scanMissingCreatedAt };
    const cat = catalog([]);
    const listSpy = vi.spyOn(cat.reader, "listOrderedByCreatedAt");
    await getPersonalGoals("owner-1", { store, catalog: cat.reader });
    expect(listWindow.mock.calls).toEqual([["owner-1"]]);
    expect(scanMissingCreatedAt.mock.calls).toEqual([["owner-1"]]);
    expect(listSpy.mock.calls).toEqual([[501]]);
  });

  it("a non-addressable id in the list window consumes its raw slot, is neither goal nor item, and does not refill", async () => {
    const s = setup();
    s.seed("u1", "bad/id", goalData(5000));
    for (let i = 0; i < 100; i += 1) s.seed("u1", gid(i), goalData(1000 - i));
    const dto = await dtoOf(s.run);
    expect(dto.goals).toHaveLength(99);
    expect(dto.recoveryItems).toEqual([]);
    expect(dto.truncated).toBe(true);
    expect(JSON.stringify(dto)).not.toContain("bad/id");
  });

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])("derives goal truncation=%s and selector truncation=%s independently", async (goalsTruncated, selectorTruncated) => {
    const trees = Array.from({ length: selectorTruncated ? 501 : 1 }, (_, i) => ({ id: `t${i}`, data: treeData(`T${i}`) }));
    const s = setup(trees);
    for (let i = 0; i < (goalsTruncated ? 101 : 3); i += 1) s.seed("u1", gid(i), goalData(i));
    const dto = await dtoOf(s.run);
    expect(dto.truncated).toBe(goalsTruncated);
    expect(dto.skillOptionsTruncated).toBe(selectorTruncated);
  });

  it("returns only the requesting owner's documents", async () => {
    const s = setup();
    s.seed("u1", "ga", goalData(1));
    s.seed("u2", "gb", goalData(2));
    expect((await dtoOf(s.run)).goals.map((g) => g.id)).toEqual(["ga"]);
  });
});

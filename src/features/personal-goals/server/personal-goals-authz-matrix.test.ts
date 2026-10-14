import { Timestamp } from "firebase-admin/firestore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GOAL_DTO_KEYS, GOAL_LIST_RESPONSE_KEYS, GOAL_PERSISTED_KEYS, GOAL_RECOVERY_DTO_KEYS } from "../domain/goal-constants";
import { createPersonalGoal } from "./create-personal-goal";
import { deletePersonalGoal } from "./delete-personal-goal";
import { getPersonalGoals } from "./get-personal-goals";
import { getDefaultGoalStore } from "./goal-store";
import { updatePersonalGoal } from "./update-personal-goal";

/**
 * D1 TASK-009: owner-isolation and recovery-reachability integration suite at the OPERATION layer.
 *
 * It runs the four production operations and the production default store (`getDefaultGoalStore`, i.e. the
 * real collection paths and query shapes) against a minimal in-memory Admin-style Firestore, precedent
 * `membership-role-regression.test.ts`. No Firebase is contacted.
 *
 * What it proves: operations are subject-scoped primitives; every actor of the SPEC matrix, calling with its
 * own verified uid, only ever addresses its own subtree; recovery items are reachable and deletable.
 * What it does NOT prove: bearer-token subject binding or HTTP behavior (routes, TASK-010/011), Firestore
 * security rules (TASK-002), real Firestore ordering/transaction semantics beyond what the in-memory
 * double models, or that the guard-free parts of the repository behave identically.
 */

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => holder.db,
}));

type Doc = Record<string, unknown>;
type CatalogReader = NonNullable<Parameters<typeof getPersonalGoals>[1]>["catalog"];

const OWNER_A = "owner-a-uid-7731";
const OWNER_B = "owner-b-uid-4402";
const BASE = Date.UTC(2026, 0, 1);
const at = (n: number) => new Date(BASE + n * 1000);
const ts = (n: number) => Timestamp.fromDate(at(n));
const pad = (n: number, width = 4) => String(n).padStart(width, "0");

const typeRank = (v: unknown) => (typeof v === "number" ? 2 : v instanceof Timestamp ? 3 : typeof v === "string" ? 4 : 6);
function compareValues(a: unknown, b: unknown): number {
  const byType = typeRank(a) - typeRank(b);
  if (byType !== 0) return byType;
  if (a instanceof Timestamp && b instanceof Timestamp) return a.toMillis() - b.toMillis();
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return 0;
}

/**
 * Minimal in-memory Admin Firestore: path-keyed documents, `orderBy` (absent field excluded, cross-type order,
 * implicit `__name__` tie-break in the same direction), `select`, `limit`, `count`, `create`, `delete` and
 * buffered transactions. It records every touched top-level collection and every mutation.
 */
function createFirestoreDouble() {
  const docs = new Map<string, Doc>();
  const topLevelCollections = new Set<string>();
  const mutations: string[] = [];
  let auto = 0;

  const children = (path: string) =>
    [...docs.entries()].filter(([p]) => p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes("/"));
  const snapshot = (path: string, mask?: string) => {
    const data = docs.get(path);
    const view = data === undefined ? undefined : mask === undefined ? { ...data } : mask in data ? { [mask]: data[mask] } : {};
    return { exists: data !== undefined, id: path.split("/").at(-1) as string, data: () => view };
  };

  const docRef = (path: string) => ({
    id: path.split("/").at(-1) as string,
    path,
    collection: (name: string) => query(`${path}/${name}`),
    async get() {
      return snapshot(path);
    },
    async create(data: Doc) {
      if (docs.has(path)) throw new Error("ALREADY_EXISTS");
      mutations.push(`create|${path}`);
      docs.set(path, { ...data });
    },
    async delete() {
      mutations.push(`delete|${path}`);
      docs.delete(path);
    },
  });

  function query(path: string, state: { order?: [string, "asc" | "desc"]; max?: number; mask?: string } = {}): Record<string, unknown> {
    return {
      doc: (id?: string) => docRef(`${path}/${id ?? `auto${pad((auto += 1), 16)}`}`),
      orderBy: (field: string, dir: "asc" | "desc") => query(path, { ...state, order: [field, dir] }),
      limit: (max: number) => query(path, { ...state, max }),
      select: (mask: string) => query(path, { ...state, mask }),
      count: () => ({ get: async () => ({ data: () => ({ count: children(path).length }) }) }),
      async get() {
        let entries = children(path);
        const sign = state.order?.[1] === "desc" ? -1 : 1;
        if (state.order) {
          const [field] = state.order;
          entries = entries.filter(([, d]) => d[field] !== undefined);
        }
        entries.sort(([pa, a], [pb, b]) => {
          const byId = pa < pb ? -1 : pa > pb ? 1 : 0;
          return sign * ((state.order ? compareValues(a[state.order[0]], b[state.order[0]]) : 0) || byId);
        });
        if (state.max !== undefined) entries = entries.slice(0, state.max);
        return { docs: entries.map(([p]) => snapshot(p, state.mask)) };
      },
    };
  }

  const db = {
    collection: (name: string) => {
      topLevelCollections.add(name);
      return query(name);
    },
    async runTransaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
      const pending = new Map<string, Doc>();
      const result = await work({
        async get(ref: { path: string }) {
          if (pending.size > 0) throw new Error("transaction read after write");
          return snapshot(ref.path);
        },
        set(ref: { path: string }, data: Doc) {
          pending.set(ref.path, { ...data });
        },
      });
      for (const [path, data] of pending) {
        mutations.push(`set|${path}`);
        docs.set(path, data);
      }
      return result;
    },
  };

  const goalPath = (owner: string, id: string) => `userDevelopment/${owner}/goals/${id}`;
  return {
    db,
    mutations,
    topLevelCollections,
    seed: (owner: string, id: string, data: Doc) => void docs.set(goalPath(owner, id), { ...data }),
    raw: (owner: string, id: string) => {
      const data = docs.get(goalPath(owner, id));
      return data && { ...data };
    },
    ids: (owner: string) => children(`userDevelopment/${owner}/goals`).map(([p]) => p.split("/").at(-1) as string).sort(),
    allStored: () => [...docs.entries()],
  };
}

const treeData = (name: string) => ({
  name,
  nodes: [
    { nodeId: "node-0", label: "A", order: 0 },
    { nodeId: "node-1", label: "B", order: 1 },
  ],
  createdAt: at(0),
  createdBy: "admin-uid",
});

/** Read-only SkillTree double; the only non-goal data source of the operations. Records every read. */
function createCatalog(trees: Record<string, unknown> = {}) {
  const reads: string[] = [];
  const fail = { list: false, getById: false, many: false };
  const find = (id: string) => ({ id, data: trees[id] });
  const reader: CatalogReader = {
    async listOrderedByCreatedAt() {
      reads.push("list");
      if (fail.list) throw new Error("SECRET-CATALOG-FAILURE");
      return Object.keys(trees).map(find);
    },
    async getById(id) {
      reads.push(`get:${id}`);
      if (fail.getById) throw new Error("SECRET-CATALOG-FAILURE");
      return find(id);
    },
    async getManyByIds(ids) {
      reads.push(`many:${ids.join(",")}`);
      if (fail.many) throw new Error("SECRET-CATALOG-FAILURE");
      return ids.map(find);
    },
  };
  return { reader, reads, fail };
}

function setup(trees: Record<string, unknown> = { tree1: treeData("Testning") }) {
  const fs = createFirestoreDouble();
  holder.db = fs.db;
  const catalog = createCatalog(trees);
  const clock = { n: 100 };
  const store = getDefaultGoalStore();
  const now = () => at(clock.n);
  return {
    ...fs,
    catalog,
    clock,
    get: async (owner: string) => {
      const result = await getPersonalGoals(owner, { store, catalog: catalog.reader });
      if (!result.ok) throw new Error(`GET failed: ${result.error}`);
      return result.dto;
    },
    getResult: (owner: string) => getPersonalGoals(owner, { store, catalog: catalog.reader }),
    create: (owner: string, input: Parameters<typeof createPersonalGoal>[1]) =>
      createPersonalGoal(owner, input, { store, catalog: catalog.reader, now }),
    update: (owner: string, id: string, input: Parameters<typeof updatePersonalGoal>[2]) =>
      updatePersonalGoal(owner, id, input, { store, catalog: catalog.reader, now }),
    remove: (owner: string, id: string) => deletePersonalGoal(owner, id, { store }),
  };
}
type Env = ReturnType<typeof setup>;

const goalDoc = (n: number, extra: Doc = {}): Doc => ({ title: `Mål ${n}`, status: "active", createdAt: ts(n), updatedAt: ts(n), ...extra });
const withoutCreatedAt = (n: number, extra: Doc = {}): Doc => {
  const { createdAt: _omitted, ...rest } = goalDoc(n, extra);
  void _omitted;
  return rest;
};
const malformedDoc = (n: number): Doc => ({
  title: "SECRET-TITLE",
  status: "bogus",
  treeId: "SECRET-TREE",
  createdAt: ts(n),
  note: "SECRET-EXTRA-FIELD",
});

const spies: Array<ReturnType<typeof vi.spyOn>> = [];
beforeEach(() => {
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    spies.push(vi.spyOn(console, method).mockImplementation(() => undefined));
  }
});
afterEach(() => {
  const logged = spies.flatMap((spy) => spy.mock.calls);
  spies.length = 0;
  vi.restoreAllMocks();
  holder.db = undefined;
  expect(logged).toEqual([]);
});

/** Deletes shown items and refetches until the owner's data is no longer truncated (BR-60 iii). */
async function drain(env: Env, owner: string, total: number) {
  let cycles = 0;
  for (;;) {
    const dto = await env.get(owner);
    if (!dto.truncated) return { dto, cycles };
    const target = dto.recoveryItems[0]?.goalId ?? dto.goals[0]?.id;
    expect(target).toBeDefined();
    await env.remove(owner, target);
    cycles += 1;
    expect(cycles).toBeLessThanOrEqual(total);
  }
}

describe("authorization matrix — every actor only addresses its own subtree (BR-1…BR-4, SI-1, SI-2, SI-4)", () => {
  // Roles are deliberately NOT inputs of any operation; each actor is just a distinct verified uid.
  const actors = ["teammate-uid", "lead-uid", "lead-and-admin-uid", "non-member-admin-uid", "former-member-uid", "unrelated-uid"];

  it.each(actors)("%s can create/read/update/delete its own goal but never sees or alters the owner's data", async (actor) => {
    const env = setup();
    const owned = await env.create(OWNER_A, { title: "OWNER-PRIVATE-TITLE", treeId: "tree1" });
    if (!owned.ok) throw new Error("fixture");
    env.seed(OWNER_A, "malformed1", malformedDoc(5));
    const before = env.ids(OWNER_A).map((id) => [id, env.raw(OWNER_A, id)]);

    const own = await env.create(actor, { title: "Eget mål" });
    if (!own.ok) throw new Error("fixture");
    const view = await env.get(actor);
    expect(view.goals.map((g) => g.id)).toEqual([own.dto.id]);
    expect(view.recoveryItems).toEqual([]);
    expect(JSON.stringify(view)).not.toContain("OWNER-PRIVATE-TITLE");
    expect(JSON.stringify(view)).not.toContain(owned.dto.id);

    // Naming the owner's goal ids from the actor's own subject only reaches the actor's own (missing) subtree.
    expect(await env.update(actor, owned.dto.id, { title: "Overtatt" })).toEqual({ ok: false, error: "goal_not_found" });
    expect(await env.update(actor, "malformed1", { title: "Overtatt" })).toEqual({ ok: false, error: "goal_not_found" });
    expect(await env.remove(actor, owned.dto.id)).toEqual({ ok: true });
    expect(await env.remove(actor, "malformed1")).toEqual({ ok: true });
    expect(await env.update(actor, own.dto.id, { status: "completed" })).toMatchObject({ ok: true });
    expect(await env.remove(actor, own.dto.id)).toEqual({ ok: true });

    expect(env.ids(OWNER_A).map((id) => [id, env.raw(OWNER_A, id)])).toEqual(before);
    expect(env.ids(actor)).toEqual([]);
    expect(env.mutations.filter((m) => m.includes(OWNER_A) && !m.startsWith("create|"))).toEqual([]);
  });

  it("an unrelated foreign id gives the same results as a missing id (SI-14, no existence oracle)", async () => {
    const env = setup();
    const owned = await env.create(OWNER_A, { title: "Eget" });
    if (!owned.ok) throw new Error("fixture");
    const foreign = await env.update(OWNER_B, owned.dto.id, { title: "x" });
    const missing = await env.update(OWNER_B, "neverexisted1", { title: "x" });
    expect(foreign).toEqual(missing);
    expect(await env.remove(OWNER_B, owned.dto.id)).toEqual(await env.remove(OWNER_B, "neverexisted1"));
  });

  it("only the goals subtree is ever read: no team, membership, invitation, access-request or admin collection", async () => {
    const env = setup();
    await env.create(OWNER_A, { title: "Mål", treeId: "tree1" });
    await env.get(OWNER_A);
    await env.update(OWNER_A, env.ids(OWNER_A)[0], { title: "Nytt" });
    await env.remove(OWNER_A, env.ids(OWNER_A)[0]);
    expect([...env.topLevelCollections]).toEqual(["userDevelopment"]);
    // The only other data source is the injected read-only SkillTree catalog (selector options + tree lookups).
    expect(env.catalog.reads.every((r) => r === "list" || r.startsWith("get:") || r.startsWith("many:"))).toBe(true);
  });

  it("membership, role and team state is not an input: signatures take the verified owner uid and the request intent only", () => {
    // Parameters up to the injected-deps default: (ownerUid), (ownerUid, input), (ownerUid, goalId, input), (ownerUid, goalId).
    expect(getPersonalGoals.length).toBe(1);
    expect(createPersonalGoal.length).toBe(2);
    expect(updatePersonalGoal.length).toBe(3);
    expect(deletePersonalGoal.length).toBe(2);
  });

  it("the owner's results are identical regardless of any membership change (no such input exists)", async () => {
    const env = setup();
    const created = await env.create(OWNER_A, { title: "Stabilt" });
    if (!created.ok) throw new Error("fixture");
    const first = await env.get(OWNER_A);
    // join / leave / rejoin / disable cannot be expressed to the operations; the same call yields the same data.
    const second = await env.get(OWNER_A);
    expect(second).toEqual(first);
    expect(second.goals).toHaveLength(1);
  });
});

describe("owner isolation A/B across operations", () => {
  it("GET returns only the caller's valid, malformed and missing-createdAt documents", async () => {
    const env = setup();
    env.seed(OWNER_A, "a-valid", goalDoc(1, { title: "A-TITLE", treeId: "tree1" }));
    env.seed(OWNER_A, "a-bad", malformedDoc(2));
    env.seed(OWNER_A, "a-lost", withoutCreatedAt(3));
    env.seed(OWNER_B, "b-valid", goalDoc(4, { title: "B-TITLE" }));
    env.seed(OWNER_B, "b-bad", malformedDoc(5));
    env.seed(OWNER_B, "b-lost", withoutCreatedAt(6));
    const dto = await env.get(OWNER_A);
    expect(dto.goals.map((g) => g.id)).toEqual(["a-valid"]);
    expect(dto.recoveryItems).toEqual([{ goalId: "a-bad" }, { goalId: "a-lost" }]);
    const text = JSON.stringify(dto);
    for (const leaked of ["B-TITLE", "b-valid", "b-bad", "b-lost", OWNER_B]) expect(text).not.toContain(leaked);
  });

  it("create writes only under the caller's subtree and nothing else changes", async () => {
    const env = setup();
    env.seed(OWNER_B, "b1", goalDoc(1));
    const bBefore = env.raw(OWNER_B, "b1");
    const created = await env.create(OWNER_A, { title: "Ny", treeId: "tree1", targetDate: "2026-12-31" });
    if (!created.ok) throw new Error("fixture");
    expect(env.mutations).toEqual([`create|userDevelopment/${OWNER_A}/goals/${created.dto.id}`]);
    expect(env.ids(OWNER_B)).toEqual(["b1"]);
    expect(env.raw(OWNER_B, "b1")).toEqual(bBefore);
  });

  it("the stored document never contains the owner uid or any key outside the persisted allow-list (path-only ownership)", async () => {
    const env = setup();
    const created = await env.create(OWNER_A, { title: "Ny", treeId: "tree1", targetDate: "2026-12-31" });
    if (!created.ok) throw new Error("fixture");
    await env.update(OWNER_A, created.dto.id, { status: "completed" });
    const stored = env.raw(OWNER_A, created.dto.id) as Doc;
    expect(Object.keys(stored).every((k) => (GOAL_PERSISTED_KEYS as readonly string[]).includes(k))).toBe(true);
    expect(JSON.stringify(env.allStored().map(([, d]) => d))).not.toContain(OWNER_A);
    expect(JSON.stringify(created)).not.toContain(OWNER_A);
  });

  it("update of the same goal id under A leaves B's persisted document structurally unchanged", async () => {
    const env = setup();
    env.seed(OWNER_A, "same-id", goalDoc(1, { title: "A-ORIGINAL" }));
    env.seed(OWNER_B, "same-id", goalDoc(1, { title: "B-ORIGINAL" }));
    const bBefore = env.raw(OWNER_B, "same-id");
    const result = await env.update(OWNER_A, "same-id", { title: "A-EDITED", status: "completed" });
    expect(result).toMatchObject({ ok: true, dto: { id: "same-id", title: "A-EDITED", status: "completed" } });
    expect(env.raw(OWNER_B, "same-id")).toEqual(bBefore);
    expect(env.mutations).toEqual([`set|userDevelopment/${OWNER_A}/goals/same-id`]);
  });

  it("delete of the same goal id under A leaves B's document; a second delete is identical and still leaves B", async () => {
    const env = setup();
    env.seed(OWNER_A, "same-id", goalDoc(1));
    env.seed(OWNER_B, "same-id", goalDoc(1, { title: "B-KEEP" }));
    expect(await env.remove(OWNER_A, "same-id")).toEqual({ ok: true });
    expect(env.raw(OWNER_A, "same-id")).toBeUndefined();
    expect(await env.remove(OWNER_A, "same-id")).toEqual({ ok: true });
    expect(env.raw(OWNER_B, "same-id")).toMatchObject({ title: "B-KEEP" });
    expect(env.mutations.every((m) => m.includes(`/${OWNER_A}/`))).toBe(true);
  });

  it("a shape-invalid goal id cannot probe another owner: update/delete never reach the store", async () => {
    const env = setup();
    env.seed(OWNER_B, "b1", goalDoc(1));
    for (const id of ["../" + OWNER_B + "/goals/b1", "a/b", "", "__x__", ".."]) {
      expect(await env.update(OWNER_A, id, { title: "x" })).toEqual({ ok: false, error: "goal_not_found" });
      expect(await env.remove(OWNER_A, id)).toEqual({ ok: true });
    }
    expect(env.mutations).toEqual([]);
    expect(env.raw(OWNER_B, "b1")).toBeDefined();
  });

  it("the cap is per owner: A at the cap does not block B, and B at the cap does not block A", async () => {
    const env = setup();
    for (let i = 0; i < 100; i += 1) env.seed(OWNER_A, `a${pad(i)}`, goalDoc(i));
    expect(await env.create(OWNER_A, { title: "For mange" })).toEqual({ ok: false, error: "goal_limit" });
    expect(await env.create(OWNER_B, { title: "B får" })).toMatchObject({ ok: true });
    for (let i = 0; i < 98; i += 1) env.seed(OWNER_B, `b${pad(i)}`, goalDoc(i));
    expect(await env.create(OWNER_B, { title: "B når taket" })).toMatchObject({ ok: true });
    expect(await env.create(OWNER_B, { title: "B over" })).toEqual({ ok: false, error: "goal_limit" });
    await env.remove(OWNER_A, "a0000");
    expect(await env.create(OWNER_A, { title: "A igjen" })).toMatchObject({ ok: true });
    expect(env.ids(OWNER_B)).toHaveLength(100);
  });

  it("deleting A's recovery item changes A's capacity only", async () => {
    const env = setup();
    for (let i = 0; i < 99; i += 1) env.seed(OWNER_A, `a${pad(i)}`, goalDoc(i));
    env.seed(OWNER_A, "a-lost", withoutCreatedAt(500));
    for (let i = 0; i < 100; i += 1) env.seed(OWNER_B, `b${pad(i)}`, goalDoc(i));
    expect(await env.create(OWNER_A, { title: "x" })).toEqual({ ok: false, error: "goal_limit" });
    await env.remove(OWNER_A, "a-lost");
    expect(await env.create(OWNER_B, { title: "x" })).toEqual({ ok: false, error: "goal_limit" });
    expect(env.ids(OWNER_B)).toHaveLength(100);
    expect(await env.create(OWNER_A, { title: "x" })).toMatchObject({ ok: true });
  });
});

describe("malformed-document recovery lifecycle (CL-2, SI-18, OQ-1)", () => {
  it.each([
    ["a malformed document inside the createdAt window", (env: Env) => env.seed(OWNER_A, "badgoal1", malformedDoc(5))],
    ["a document without createdAt found by the recovery scan", (env: Env) => env.seed(OWNER_A, "lostgoal1", withoutCreatedAt(5, { title: "SECRET-TITLE", note: "SECRET-EXTRA-FIELD" }))],
    ["a document with a string-typed createdAt", (env: Env) => env.seed(OWNER_A, "stringgoal", goalDoc(5, { createdAt: "SECRET-2026-01-01" }))],
    ["a document with an unknown top-level key", (env: Env) => env.seed(OWNER_A, "unknownkey", goalDoc(5, { title: "SECRET-TITLE", note: "SECRET-EXTRA-FIELD" }))],
  ])("%s: recovery item only → update not found without repair → delete → clean, idempotent", async (_name, seed) => {
    const env = setup();
    seed(env);
    const [id] = env.ids(OWNER_A);

    const first = await env.get(OWNER_A);
    expect(first.goals).toEqual([]);
    expect(first.recoveryItems).toEqual([{ goalId: id }]);
    expect(Object.keys(first)).toEqual([...GOAL_LIST_RESPONSE_KEYS]);
    expect(Object.keys(first.recoveryItems[0])).toEqual([...GOAL_RECOVERY_DTO_KEYS]);

    const stored = env.raw(OWNER_A, id);
    const updated = await env.update(OWNER_A, id, { title: "Reparer", status: "completed" });
    expect(updated).toEqual({ ok: false, error: "goal_not_found" });
    expect(env.raw(OWNER_A, id)).toEqual(stored);
    expect(env.mutations).toEqual([]);

    expect(await env.remove(OWNER_A, id)).toEqual({ ok: true });
    expect(env.ids(OWNER_A)).toEqual([]);
    const clean = await env.get(OWNER_A);
    expect(clean.goals).toEqual([]);
    expect(clean.recoveryItems).toEqual([]);
    expect(await env.remove(OWNER_A, id)).toEqual({ ok: true });
    expect((await env.get(OWNER_A)).recoveryItems).toEqual([]);

    const everything = JSON.stringify([first, updated, clean]);
    for (const secret of ["SECRET", "bogus", OWNER_A]) expect(everything).not.toContain(secret);
  });

  it("recovery items and goals never carry content keys, and goals keep the exact DTO keys", async () => {
    const env = setup();
    env.seed(OWNER_A, "okgoal", goalDoc(1, { treeId: "tree1" }));
    env.seed(OWNER_A, "badgoal", malformedDoc(2));
    const dto = await env.get(OWNER_A);
    expect(Object.keys(dto.goals[0])).toEqual([...GOAL_DTO_KEYS]);
    expect(dto.goals[0]).toMatchObject({ areaName: "Testning", areaAvailable: true });
    expect(dto.recoveryItems.map((r) => Object.keys(r))).toEqual([["goalId"]]);
    expect(JSON.stringify(dto)).not.toMatch(/SECRET|nodes|createdBy|admin-uid/);
  });

  it("a non-addressable stored document consumes a slot and counts toward the cap but is neither goal nor recovery item and cannot be deleted", async () => {
    const env = setup();
    env.seed(OWNER_A, "not addressable", malformedDoc(9));
    for (let i = 0; i < 99; i += 1) env.seed(OWNER_A, `a${pad(i)}`, goalDoc(i));
    const dto = await env.get(OWNER_A);
    expect(dto.goals).toHaveLength(99);
    expect(dto.recoveryItems).toEqual([]);
    expect(JSON.stringify(dto)).not.toContain("not addressable");
    expect(await env.create(OWNER_A, { title: "x" })).toEqual({ ok: false, error: "goal_limit" });
    expect(await env.remove(OWNER_A, "not addressable")).toEqual({ ok: true });
    expect(await env.update(OWNER_A, "not addressable", { title: "x" })).toEqual({ ok: false, error: "goal_not_found" });
    expect(env.mutations).toEqual([]);
    expect(env.raw(OWNER_A, "not addressable")).toBeDefined();
  });

  it("a non-addressable document without createdAt is not a recovery item either", async () => {
    const env = setup();
    env.seed(OWNER_A, "bad id!", withoutCreatedAt(1));
    expect(await env.get(OWNER_A)).toMatchObject({ goals: [], recoveryItems: [], truncated: false });
  });
});

describe("reachability invariant BR-60", () => {
  it("(i) N = 100 mixed documents: every addressable document is in exactly one of goals / recoveryItems", async () => {
    const env = setup();
    const valid: string[] = [];
    const others: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      env.seed(OWNER_A, `v${pad(i)}`, goalDoc(i));
      valid.push(`v${pad(i)}`);
      env.seed(OWNER_A, `m${pad(i)}`, malformedDoc(i + 30));
      env.seed(OWNER_A, `l${pad(i)}`, i % 2 === 0 ? withoutCreatedAt(i) : withoutCreatedAt(i, { status: "bogus" }));
      env.seed(OWNER_A, `s${pad(i)}`, goalDoc(i, { createdAt: `2026-01-${pad(i + 1, 2)}` }));
      others.push(`m${pad(i)}`, `l${pad(i)}`, `s${pad(i)}`);
    }
    expect(env.ids(OWNER_A)).toHaveLength(100);
    const dto = await env.get(OWNER_A);
    expect(dto.truncated).toBe(false);
    const goalIds = dto.goals.map((g) => g.id);
    const recoveryIds = dto.recoveryItems.map((r) => r.goalId);
    expect(goalIds.sort()).toEqual(valid.sort());
    expect(recoveryIds).toEqual([...others].sort());
    expect(new Set([...goalIds, ...recoveryIds]).size).toBe(100);
  });

  it("(ii) at goal_limit with invisible counted documents a deletable item exists and deleting it lets create succeed", async () => {
    const env = setup();
    for (let i = 0; i < 98; i += 1) env.seed(OWNER_A, `g${pad(i)}`, goalDoc(i));
    env.seed(OWNER_A, "lost1", withoutCreatedAt(1));
    env.seed(OWNER_A, "lost2", withoutCreatedAt(2));
    const dto = await env.get(OWNER_A);
    expect(dto.goals).toHaveLength(98);
    expect(dto.recoveryItems).toEqual([{ goalId: "lost1" }, { goalId: "lost2" }]);
    expect(dto.truncated).toBe(false);
    expect(await env.create(OWNER_A, { title: "x" })).toEqual({ ok: false, error: "goal_limit" });
    expect(await env.remove(OWNER_A, dto.recoveryItems[0].goalId)).toEqual({ ok: true });
    expect(await env.create(OWNER_A, { title: "x" })).toMatchObject({ ok: true });
    expect((await env.get(OWNER_A)).recoveryItems).toEqual([{ goalId: "lost2" }]);
  });

  it("(ii) an at-cap owner whose counted documents are all malformed is not locked out", async () => {
    const env = setup();
    for (let i = 0; i < 100; i += 1) env.seed(OWNER_A, `m${pad(i)}`, malformedDoc(i));
    expect(await env.create(OWNER_A, { title: "x" })).toEqual({ ok: false, error: "goal_limit" });
    const dto = await env.get(OWNER_A);
    expect(dto.recoveryItems).toHaveLength(100);
    await env.remove(OWNER_A, dto.recoveryItems[0].goalId);
    expect(await env.create(OWNER_A, { title: "x" })).toMatchObject({ ok: true });
  });

  it("(iii) 103 documents all lacking createdAt: the first 100 by id are recovery items, drain reveals the rest", async () => {
    const env = setup();
    const ids = Array.from({ length: 103 }, (_, i) => `l${pad(i)}`);
    for (const id of ids) env.seed(OWNER_A, id, withoutCreatedAt(1));
    const first = await env.get(OWNER_A);
    expect(first.truncated).toBe(true);
    expect(first.goals).toEqual([]);
    expect(first.recoveryItems.map((r) => r.goalId)).toEqual(ids.slice(0, 100));
    const { dto, cycles } = await drain(env, OWNER_A, 103);
    expect(cycles).toBe(3);
    expect(dto.truncated).toBe(false);
    expect(dto.recoveryItems.map((r) => r.goalId)).toEqual(env.ids(OWNER_A));
    expect(dto.recoveryItems).toHaveLength(100);
  });

  it("(iii) 103 documents all malformed with createdAt: the newest 100 are shown, drain reveals the older ones", async () => {
    const env = setup();
    const ids = Array.from({ length: 103 }, (_, i) => `m${pad(i)}`);
    ids.forEach((id, i) => env.seed(OWNER_A, id, malformedDoc(i)));
    const first = await env.get(OWNER_A);
    expect(first.truncated).toBe(true);
    expect(first.recoveryItems).toHaveLength(100);
    // m0000…m0002 are the oldest and lie beyond the raw window.
    expect(first.recoveryItems.map((r) => r.goalId)).not.toContain("m0000");
    const { dto, cycles } = await drain(env, OWNER_A, 103);
    expect(cycles).toBe(3);
    expect(dto.recoveryItems.map((r) => r.goalId)).toEqual(env.ids(OWNER_A));
    expect(env.ids(OWNER_A)).toContain("m0000");
  });

  it("(iii) mixed overshoot (105): truncated, delete-and-refetch drains until every remaining document is visible; the cap is not strict", async () => {
    const env = setup();
    for (let i = 0; i < 60; i += 1) env.seed(OWNER_A, `v${pad(i)}`, goalDoc(i));
    for (let i = 0; i < 25; i += 1) env.seed(OWNER_A, `m${pad(i)}`, malformedDoc(i + 100));
    for (let i = 0; i < 20; i += 1) env.seed(OWNER_A, `l${pad(i)}`, withoutCreatedAt(i));
    expect((await env.get(OWNER_A)).truncated).toBe(true);
    expect(await env.create(OWNER_A, { title: "x" })).toEqual({ ok: false, error: "goal_limit" });
    const { dto, cycles } = await drain(env, OWNER_A, 105);
    expect(cycles).toBe(5);
    expect([...dto.goals.map((g) => g.id), ...dto.recoveryItems.map((r) => r.goalId)].sort()).toEqual(env.ids(OWNER_A));
  });

  it("(iii) overshoot of A does not make B truncated", async () => {
    const env = setup();
    for (let i = 0; i < 103; i += 1) env.seed(OWNER_A, `l${pad(i)}`, withoutCreatedAt(1));
    env.seed(OWNER_B, "b1", goalDoc(1));
    expect(await env.get(OWNER_B)).toMatchObject({ truncated: false, recoveryItems: [] });
  });
});

describe("cross-operation behavior and failure boundaries", () => {
  it("TASK-008 post-commit area failure: persistence_failed, the mutation stays, the same absolute retry is a no-op success", async () => {
    const env = setup();
    env.seed(OWNER_A, "g1", goalDoc(1, { treeId: "tree1" }));
    env.clock.n = 200;
    env.catalog.fail.getById = true;
    expect(await env.update(OWNER_A, "g1", { title: "Ny tittel" })).toEqual({ ok: false, error: "persistence_failed" });
    const committed = env.raw(OWNER_A, "g1");
    expect(committed).toMatchObject({ title: "Ny tittel" });
    expect((committed?.updatedAt as Timestamp).toMillis()).toBe(at(200).getTime());

    env.catalog.fail.getById = false;
    env.clock.n = 300;
    const retry = await env.update(OWNER_A, "g1", { title: "Ny tittel" });
    expect(retry).toMatchObject({ ok: true, dto: { title: "Ny tittel", areaName: "Testning", updatedAt: at(200).toISOString() } });
    expect(env.raw(OWNER_A, "g1")).toEqual(committed);
    expect(env.mutations).toEqual([`set|userDevelopment/${OWNER_A}/goals/g1`]);
  });

  it("catalog failures: GET yields no partial envelope, create writes nothing, update with a changed tree writes nothing", async () => {
    const env = setup();
    env.seed(OWNER_A, "g1", goalDoc(1));
    env.catalog.fail.list = true;
    expect(await env.getResult(OWNER_A)).toEqual({ ok: false, error: "persistence_failed" });
    env.catalog.fail.list = false;
    env.catalog.fail.getById = true;
    expect(await env.create(OWNER_A, { title: "x", treeId: "tree1" })).toEqual({ ok: false, error: "persistence_failed" });
    expect(await env.update(OWNER_A, "g1", { treeId: "tree1" })).toEqual({ ok: false, error: "persistence_failed" });
    expect(env.mutations).toEqual([]);
    expect(env.ids(OWNER_A)).toEqual(["g1"]);
  });

  it("errors are stable discriminators: no raw error text, ids, titles or foreign content", async () => {
    const env = setup();
    env.seed(OWNER_A, "g1", goalDoc(1, { treeId: "tree1", title: "OWN-TITLE" }));
    env.catalog.fail.getById = true;
    env.catalog.fail.many = true;
    const results = [
      await env.getResult(OWNER_A),
      await env.update(OWNER_A, "g1", { treeId: "tree1", title: "SECRET-NEW" }),
      await env.create(OWNER_A, { title: "SECRET-NEW2", treeId: "tree1" }),
      await env.update(OWNER_A, "nogoal", { title: "x" }),
      await env.create(OWNER_A, { title: "   " }),
    ];
    expect(results.map((r) => (r.ok ? "ok" : r.error))).toEqual([
      "persistence_failed",
      "persistence_failed",
      "persistence_failed",
      "goal_not_found",
      "invalid_title",
    ]);
    for (const result of results) {
      expect(Object.keys(result)).toEqual(["ok", "error"]);
      expect(JSON.stringify(result)).not.toMatch(/SECRET|OWN-TITLE|g1|nogoal|userDevelopment/);
    }
  });

  it("persistence failures from the store are stable too and carry no store detail", async () => {
    const env = setup();
    holder.db = {
      collection: () => {
        throw new Error("SECRET-FIRESTORE-FAILURE userDevelopment");
      },
    };
    const results = [
      await env.getResult(OWNER_A),
      await env.create(OWNER_A, { title: "x" }),
      await env.update(OWNER_A, "g1", { title: "x" }),
      await env.remove(OWNER_A, "g1"),
    ];
    for (const result of results) expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });
});

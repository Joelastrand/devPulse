import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyGoalChange, createGoal, parseStoredGoal, type Goal } from "../domain/goal";
import { getDefaultGoalStore } from "./goal-store";

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => holder.db,
}));

type Data = Record<string, unknown>;
interface Script {
  queryDocs?: Array<{ id: string; data: Data }>;
  docData?: Data;
  count?: number;
  fail?: Error;
}

/** Recording double of the Admin Firestore surface the store uses; records the exact call chain, never contacts Firebase. */
function createRecordingDb(script: Script = {}) {
  const log: string[] = [];
  const written: Array<{ op: "create" | "set"; path: string; data: Data }> = [];
  let auto = 0;
  const fail = () => {
    if (script.fail) throw script.fail;
  };

  const docRef = (path: string, id: string) => ({
    id,
    path: `${path}/${id}`,
    collection: (name: string) => query(`${path}/${id}/${name}`, []),
    async get() {
      log.push(`${path}/${id}|get`);
      fail();
      return { exists: script.docData !== undefined, id, data: () => script.docData };
    },
    async delete() {
      log.push(`${path}/${id}|delete`);
      fail();
    },
    async create(data: Data) {
      log.push(`${path}/${id}|create`);
      fail();
      written.push({ op: "create", path: `${path}/${id}`, data });
    },
  });

  const query = (path: string, ops: string[]): Record<string, unknown> => ({
    doc: (id?: string) => docRef(path, id ?? `auto${String((auto += 1)).padStart(16, "0")}`),
    orderBy: (field: string, dir: string) => query(path, [...ops, `orderBy(${field},${dir})`]),
    limit: (n: number) => query(path, [...ops, `limit(${n})`]),
    select: (field: string) => query(path, [...ops, `select(${field})`]),
    count: () => ({
      async get() {
        log.push([path, ...ops, "count", "get"].join("|"));
        fail();
        return { data: () => ({ count: script.count ?? 0 }) };
      },
    }),
    async get() {
      log.push([path, ...ops, "get"].join("|"));
      fail();
      return { docs: (script.queryDocs ?? []).map((d) => ({ id: d.id, data: () => d.data })) };
    },
  });

  const db = {
    collection: (name: string) => query(name, []),
    async runTransaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
      log.push("runTransaction");
      return work({
        async get(ref: { path: string; id: string }) {
          log.push(`tx.get|${ref.path}`);
          fail();
          return { exists: script.docData !== undefined, id: ref.id, data: () => script.docData };
        },
        set(ref: { path: string }, data: Data) {
          log.push(`tx.set|${ref.path}`);
          written.push({ op: "set", path: ref.path, data });
        },
      });
    },
  };
  return { db, log, written };
}

function install(script?: Script) {
  const recording = createRecordingDb(script);
  holder.db = recording.db;
  return recording;
}

const T0 = new Date("2026-03-01T10:00:00.123Z");
const T1 = new Date("2026-03-02T11:30:00.456Z");
const store = getDefaultGoalStore();

function activeGoal(fields: { title?: string; treeId?: string; targetDate?: string } = {}): Goal {
  return createGoal({ title: fields.title ?? "Lær Rust", ...fields }, T0);
}

function completedGoal(): Goal {
  const result = applyGoalChange(activeGoal(), { status: "completed" }, T1);
  if (!result.changed) throw new Error("fixture");
  return result.goal;
}

beforeEach(() => {
  holder.db = undefined;
});

describe("goal store (Admin SDK) — owner-scoped paths", () => {
  const PATH = "userDevelopment/owner-a/goals";

  it("scopes every function to userDevelopment/{ownerUid}/goals", async () => {
    const { log } = install({ queryDocs: [], docData: undefined, count: 0 });
    await store.create("owner-a", activeGoal());
    await store.listWindow("owner-a");
    await store.scanMissingCreatedAt("owner-a");
    await store.count("owner-a");
    await store.get("owner-a", "goal1");
    await store.runTransaction("owner-a", "goal1", async (tx) => tx.read());
    await store.delete("owner-a", "goal1");
    expect(log.length).toBeGreaterThan(0);
    for (const entry of log.filter((e) => e !== "runTransaction")) {
      expect(entry.replace(/^tx\.(get|set)\|/, "").startsWith(PATH)).toBe(true);
    }
  });

  it("builds a different path for a different owner and never queries across owners", async () => {
    const { log } = install();
    await store.listWindow("owner-b");
    await store.delete("owner-b", "same-id");
    expect(log).toEqual([
      "userDevelopment/owner-b/goals|orderBy(createdAt,desc)|limit(101)|get",
      "userDevelopment/owner-b/goals/same-id|delete",
    ]);
  });

  it.each(["", "a/b", ".", "..", "__x__"])("refuses owner %j before touching Firestore", async (owner) => {
    const { log } = install();
    await expect(store.listWindow(owner)).rejects.toThrow("invalid goal store key");
    await expect(store.delete(owner, "goal1")).rejects.toThrow("invalid goal store key");
    expect(log).toEqual([]);
  });

  it.each(["", "a/b", ".", "..", "__x__", "__foo__", "with space", " a", "x".repeat(129), "a.b"])(
    "refuses goal id %j before touching Firestore",
    async (goalId) => {
      const { log } = install();
      await expect(store.get("owner-a", goalId)).rejects.toThrow("invalid goal store key");
      await expect(store.delete("owner-a", goalId)).rejects.toThrow("invalid goal store key");
      await expect(store.runTransaction("owner-a", goalId, async () => 1)).rejects.toThrow("invalid goal store key");
      expect(log).toEqual([]);
    },
  );
});

describe("goal store (Admin SDK) — exact query shapes (BR-30, BR-58, BR-34)", () => {
  it("lists with exactly orderBy(createdAt, desc).limit(101)", async () => {
    const { log } = install();
    await store.listWindow("u1");
    expect(log).toEqual(["userDevelopment/u1/goals|orderBy(createdAt,desc)|limit(101)|get"]);
  });

  it("scans with exactly select(createdAt).limit(101) and no orderBy or where", async () => {
    const { log } = install();
    await store.scanMissingCreatedAt("u1");
    expect(log).toEqual(["userDevelopment/u1/goals|select(createdAt)|limit(101)|get"]);
  });

  it("counts with a bare count() aggregation over the whole subcollection", async () => {
    const { log } = install({ count: 7 });
    await expect(store.count("u1")).resolves.toBe(7);
    expect(log).toEqual(["userDevelopment/u1/goals|count|get"]);
  });
});

describe("goal store (Admin SDK) — bounded windows", () => {
  const docs = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `g${String(i).padStart(3, "0")}`, data: { createdAt: Timestamp.fromDate(T0) } }));

  it.each([
    [0, 0, 0],
    [1, 1, 1],
    [99, 99, 99],
    [100, 100, 100],
    [101, 100, 101],
  ])("list window of %i raw documents returns %i candidates and rawCount %i (probe never returned)", async (raw, candidates, rawCount) => {
    install({ queryDocs: docs(raw) });
    const result = await store.listWindow("u1");
    expect(result.docs).toHaveLength(candidates);
    expect(result.rawCount).toBe(rawCount);
    expect(result.docs.some((d) => d.id === "g100")).toBe(false);
  });

  it("returns malformed and non-timestamp createdAt documents as raw material, keeping their slots", async () => {
    install({
      queryDocs: [
        { id: "a", data: { createdAt: "yesterday", title: "x" } },
        { id: "b", data: { createdAt: Timestamp.fromDate(T0), extra: 1 } },
      ],
    });
    const result = await store.listWindow("u1");
    expect(result.docs.map((d) => d.id)).toEqual(["a", "b"]);
    expect(result.docs[0].data.createdAt).toBe("yesterday");
    expect(result.rawCount).toBe(2);
  });

  it("scan yields only ids whose createdAt is absent, within the first 100 raw documents", async () => {
    const scanned = Array.from({ length: 101 }, (_, i) => ({
      id: `s${String(i).padStart(3, "0")}`,
      data: i % 2 === 0 ? {} : { createdAt: Timestamp.fromDate(T0) },
    }));
    scanned[100] = { id: "s100", data: {} }; // the probe: absent createdAt but never examined
    install({ queryDocs: scanned });
    const result = await store.scanMissingCreatedAt("u1");
    expect(result.rawCount).toBe(101);
    expect(result.missingCreatedAtIds).toHaveLength(50);
    expect(result.missingCreatedAtIds).toContain("s000");
    expect(result.missingCreatedAtIds).not.toContain("s100");
  });

  it("scan treats a present non-timestamp createdAt (even null) as present", async () => {
    install({ queryDocs: [{ id: "n", data: { createdAt: null } }, { id: "m", data: {} }] });
    await expect(store.scanMissingCreatedAt("u1")).resolves.toEqual({ missingCreatedAtIds: ["m"], rawCount: 2 });
  });
});

describe("goal store (Admin SDK) — create and canonical keys (BR-6, BR-7, BR-14)", () => {
  it("writes exactly the canonical keys of a minimal active goal, via create (never overwrite)", async () => {
    const { written, log } = install();
    const id = await store.create("u1", activeGoal());
    expect(log).toEqual([`userDevelopment/u1/goals/${id}|create`]);
    expect(written).toHaveLength(1);
    expect(written[0].op).toBe("create");
    expect(Object.keys(written[0].data).sort()).toEqual(["createdAt", "status", "title", "updatedAt"]);
  });

  it("writes optional keys only when set and completedAt iff completed", async () => {
    const { written } = install();
    await store.create("u1", activeGoal({ treeId: "tree-1", targetDate: "2026-12-31" }));
    await store.create("u1", completedGoal());
    expect(Object.keys(written[0].data).sort()).toEqual(["createdAt", "status", "targetDate", "title", "treeId", "updatedAt"]);
    expect(Object.keys(written[1].data).sort()).toEqual(["completedAt", "createdAt", "status", "title", "updatedAt"]);
    for (const { data } of written) {
      for (const forbidden of ["uid", "ownerUid", "email", "teamId", "memberRef", "sharing", "consent"]) {
        expect(data).not.toHaveProperty(forbidden);
      }
      expect(Object.values(data).every((v) => v !== null && v !== undefined)).toBe(true);
    }
  });

  it("converts Dates to Timestamps with millisecond fidelity and no serverTimestamp placeholder", async () => {
    const { written } = install();
    await store.create("u1", completedGoal());
    const data = written[0].data;
    for (const key of ["createdAt", "updatedAt", "completedAt"]) {
      expect(data[key]).toBeInstanceOf(Timestamp);
    }
    expect((data.createdAt as Timestamp).toMillis()).toBe(T0.getTime());
    expect((data.updatedAt as Timestamp).toMillis()).toBe(T1.getTime());
    expect((data.completedAt as Timestamp).toMillis()).toBe(T1.getTime());
  });

  it("uses the injected id generator, and Firestore's auto-id by default", async () => {
    const injected = install();
    const id = await getDefaultGoalStore({ generateId: () => "fixedGoalId123" }).create("u1", activeGoal());
    expect(id).toBe("fixedGoalId123");
    expect(injected.log).toEqual(["userDevelopment/u1/goals/fixedGoalId123|create"]);

    install();
    const auto = await store.create("u1", activeGoal());
    expect(auto).toMatch(/^auto\d{16}$/);
  });

  it.each(["x", "_", "-", "_a", "a__", "a".repeat(128)])("accepts the boundary-valid goal id %j", async (goalId) => {
    const { log } = install();
    await store.delete("owner-a", goalId);
    expect(log).toEqual([`userDevelopment/owner-a/goals/${goalId}|delete`]);
  });

  it("persists only the canonical keys even if the goal object carries extra properties", async () => {
    const { written } = install();
    const polluted = { ...activeGoal(), ownerUid: "u1", uid: "u1", teamId: "t", sharing: true } as unknown as Goal;
    await store.create("u1", polluted);
    expect(Object.keys(written[0].data).sort()).toEqual(["createdAt", "status", "title", "updatedAt"]);
  });

  it("refuses an injected id that is not addressable before writing", async () => {
    const { log } = install();
    await expect(getDefaultGoalStore({ generateId: () => "a/b" }).create("u1", activeGoal())).rejects.toThrow("invalid goal store key");
    expect(log).toEqual([]);
  });

  it("does not clamp or rewrite a regressed timestamp (BR-64): it persists what it is given", async () => {
    const { written } = install();
    const regressed: Goal = { ...activeGoal(), updatedAt: new Date(T0.getTime() - 5000) };
    await store.create("u1", regressed);
    expect((written[0].data.updatedAt as Timestamp).toMillis()).toBe(T0.getTime() - 5000);
  });
});

describe("goal store (Admin SDK) — reads, round trip and fail-closed parsing", () => {
  it("maps stored Timestamps back to Dates; a written goal parses back to the same domain meaning", async () => {
    const written = install();
    const goal = completedGoal();
    await store.create("u1", goal);
    install({ docData: written.written[0].data });
    const raw = await store.get("u1", "goal1");
    expect(raw?.createdAt).toBeInstanceOf(Date);
    expect(raw?.createdAt).not.toBeInstanceOf(Timestamp);
    const parsed = parseStoredGoal(raw);
    expect(parsed).toEqual({ ok: true, goal });
  });

  it("returns undefined for an absent document", async () => {
    install({ docData: undefined });
    await expect(store.get("u1", "goal1")).resolves.toBeUndefined();
  });

  it("passes non-Timestamp timestamps and unknown keys through untouched so the parser fails closed", async () => {
    const stored = {
      title: "Lær Rust",
      status: "active",
      createdAt: "2026-03-01T10:00:00.123Z",
      updatedAt: 1772359200123,
      extra: "kept raw",
    };
    install({ docData: stored });
    const raw = await store.get("u1", "goal1");
    expect(raw).toEqual(stored);
    expect(parseStoredGoal(raw)).toEqual({ ok: false });
  });

  it("surfaces a read failure as a rejection, never as absence", async () => {
    install({ fail: new Error("unavailable") });
    await expect(store.get("u1", "goal1")).rejects.toThrow("unavailable");
    await expect(store.listWindow("u1")).rejects.toThrow("unavailable");
    await expect(store.scanMissingCreatedAt("u1")).rejects.toThrow("unavailable");
    await expect(store.count("u1")).rejects.toThrow("unavailable");
    await expect(store.delete("u1", "goal1")).rejects.toThrow("unavailable");
    await expect(store.create("u1", activeGoal())).rejects.toThrow("unavailable");
    await expect(store.runTransaction("u1", "goal1", async (tx) => tx.read())).rejects.toThrow("unavailable");
  });
});

describe("goal store (Admin SDK) — transaction and delete", () => {
  it("reads and writes the single goal document inside one Firestore transaction", async () => {
    const { log, written } = install({ docData: { title: "x" } });
    const goal = completedGoal();
    await store.runTransaction("u1", "goal1", async (tx) => {
      await tx.read();
      tx.write(goal);
    });
    expect(log).toEqual(["runTransaction", "tx.get|userDevelopment/u1/goals/goal1", "tx.set|userDevelopment/u1/goals/goal1"]);
    expect(Object.keys(written[0].data).sort()).toEqual(["completedAt", "createdAt", "status", "title", "updatedAt"]);
  });

  it("returns the work result and refuses to write a goal that was not read as existing", async () => {
    install({ docData: undefined });
    await expect(
      store.runTransaction("u1", "goal1", async (tx) => {
        await tx.read();
        tx.write(activeGoal());
      }),
    ).rejects.toThrow("not read as existing");
    install({ docData: { title: "x" } });
    await expect(store.runTransaction("u1", "goal1", async (tx) => (await tx.read())?.title)).resolves.toBe("x");
    install({ docData: { title: "x" } });
    await expect(store.runTransaction("u1", "goal1", async (tx) => tx.write(activeGoal()))).rejects.toThrow("not read as existing");
  });

  it("deletes by owner and id without any read", async () => {
    const { log } = install({ docData: { malformed: true } });
    await store.delete("u1", "goal1");
    expect(log).toEqual(["userDevelopment/u1/goals/goal1|delete"]);
  });
});

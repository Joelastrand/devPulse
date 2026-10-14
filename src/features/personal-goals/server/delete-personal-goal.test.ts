import { afterEach, describe, expect, it, vi } from "vitest";
import { deletePersonalGoal } from "./delete-personal-goal";
import { createFakeGoalStore } from "./fake-goal-store";
import type { GoalStore } from "./goal-store-types";

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
const goalData = (n: number) => ({ title: `Mål ${n}`, status: "active", createdAt: at(n), updatedAt: at(n) });

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

afterEach(() => vi.restoreAllMocks());

describe("deletePersonalGoal", () => {
  it("deletes a valid goal with exactly one owner-scoped delete and no read", async () => {
    const s = spied();
    s.seed("u1", "ga", goalData(1));
    expect(await deletePersonalGoal("u1", "ga", { store: s.store })).toEqual({ ok: true });
    expect(s.calls).toEqual([["delete", "u1", "ga"]]);
    expect(s.peek("u1", "ga")).toBeUndefined();
    expect(s.reads.count).toBe(0);
  });

  it("is idempotent for a missing goal: same result, one delete, no pre-read", async () => {
    const s = spied();
    expect(await deletePersonalGoal("u1", "never", { store: s.store })).toEqual({ ok: true });
    expect(await deletePersonalGoal("u1", "never", { store: s.store })).toEqual({ ok: true });
    expect(s.names()).toEqual(["delete", "delete"]);
  });

  it.each([
    ["malformed", { title: "x", status: "bogus", createdAt: at(1), treeId: "t" }],
    ["missing-createdAt", { title: "x" }],
    ["unknown-key", { ...goalData(1), uid: "nope" }],
  ])("deletes a %s document without reading or parsing it", async (_label, data) => {
    const s = spied();
    s.seed("u1", "gm", data);
    expect(await deletePersonalGoal("u1", "gm", { store: s.store })).toEqual({ ok: true });
    expect(s.peek("u1", "gm")).toBeUndefined();
    expect(s.names()).toEqual(["delete"]);
    expect(s.reads.count).toBe(0);
  });

  it.each(["__x__", "__foo__", "a/b", ".", "..", "", " ", "a b", "x".repeat(129), "å", "../u2/ga"])(
    "treats shape-invalid id %j as already absent with zero store calls",
    async (goalId) => {
      const s = spied();
      expect(await deletePersonalGoal("u1", goalId, { store: s.store })).toEqual({ ok: true });
      expect(s.calls).toEqual([]);
    },
  );

  it.each(["_", "-", "_a", "a_", "x".repeat(128), "A-z_09"])("passes boundary-valid id %j to the store", async (goalId) => {
    const s = spied();
    expect(await deletePersonalGoal("u1", goalId, { store: s.store })).toEqual({ ok: true });
    expect(s.calls).toEqual([["delete", "u1", goalId]]);
  });

  it("never touches another owner's document with the same id", async () => {
    const s = spied();
    s.seed("owner-a", "same", goalData(1));
    s.seed("owner-b", "same", goalData(2));
    await deletePersonalGoal("owner-a", "same", { store: s.store });
    expect(s.peek("owner-a", "same")).toBeUndefined();
    expect(s.peek("owner-b", "same")).toBeDefined();
    expect(s.calls).toEqual([["delete", "owner-a", "same"]]);
  });

  it("maps a store failure to persistence_failed without detail or logging", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m));
    const store = { ...createFakeGoalStore().store, delete: () => Promise.reject(new Error("secret internal")) };
    const result = await deletePersonalGoal("u1", "ga", { store });
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("secret");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

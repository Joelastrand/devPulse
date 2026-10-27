import { describe, expect, it } from "vitest";
import { SHARED_GOAL_SNAPSHOT_KEYS } from "../domain/shared-goal-snapshot";
import { productionOwnedGoalReader, readOwnedGoalSnapshots, type OwnedGoalReader } from "./read-owned-goal-snapshots";

describe("productionOwnedGoalReader (TASK-023 S-3 least privilege)", () => {
  it("exposes only the get capability: no create, update, delete or list reaches D2 through the reader", () => {
    const reader = productionOwnedGoalReader();
    expect(Object.keys(reader)).toEqual(["get"]);
    expect(typeof reader.get).toBe("function");
  });
});

const OWNER_UID = "owner-1";
const OTHER_OWNER_UID = "owner-2";
const NOW = new Date("2026-10-17T09:30:00.000Z");

/** Stored D1-shaped goal data as a raw read returns it: timestamps already `Date`s, optional keys omitted. */
function goalData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Lead a code review",
    status: "active",
    createdAt: new Date("2026-09-01T08:00:00.000Z"),
    updatedAt: new Date("2026-09-02T08:00:00.000Z"),
    ...overrides,
  };
}

/**
 * Test-local goal reader keyed by owner and goal id. It records every call so tests can prove which owner the seam
 * reads with and how many point reads it makes. It does not import the D1 store or its fake.
 */
function fakeGoalReader(seed: Record<string, Record<string, Record<string, unknown>>> = {}) {
  const goals = new Map<string, Record<string, unknown>>();
  for (const [owner, byGoal] of Object.entries(seed)) {
    for (const [goalId, data] of Object.entries(byGoal)) goals.set(`${owner}/${goalId}`, data);
  }
  const calls: Array<{ ownerUid: string; goalId: string }> = [];
  let failNext = false;
  const reader: OwnedGoalReader = {
    async get(ownerUid, goalId) {
      calls.push({ ownerUid, goalId });
      if (failNext) {
        failNext = false;
        throw new Error("simulated Firestore failure with a secret path");
      }
      const data = goals.get(`${ownerUid}/${goalId}`);
      return data === undefined ? undefined : structuredClone(data);
    },
  };
  return {
    reader,
    calls,
    /** Test only: mutates the stored goal in place, as a D1 edit, completion, reopen or delete would. */
    mutate(ownerUid: string, goalId: string, data: Record<string, unknown> | null) {
      if (data === null) goals.delete(`${ownerUid}/${goalId}`);
      else goals.set(`${ownerUid}/${goalId}`, data);
    },
    failNextRead() {
      failNext = true;
    },
  };
}

const deps = (reader: OwnedGoalReader) => ({ goalStore: reader, clock: () => new Date(NOW) });

describe("readOwnedGoalSnapshots — owner's goals", () => {
  it("returns one snapshot per selected goal, in request order, with exactly the snapshot keys", async () => {
    const fake = fakeGoalReader({
      [OWNER_UID]: {
        goalA: goalData({ title: "Lead a code review" }),
        goalB: goalData({ title: "Learn Rust", treeId: "tree-eng", targetDate: "2026-12-31", status: "completed", completedAt: new Date("2026-10-01T08:00:00.000Z") }),
      },
    });

    const result = await readOwnedGoalSnapshots(OWNER_UID, ["goalB", "goalA"], deps(fake.reader));

    expect(result).toEqual({
      ok: true,
      snapshots: [
        { goalTitle: "Learn Rust", treeId: "tree-eng", targetDate: "2026-12-31", status: "completed", capturedAt: NOW },
        { goalTitle: "Lead a code review", treeId: null, targetDate: null, status: "active", capturedAt: NOW },
      ],
    });
    if (!result.ok) throw new Error("expected success");
    for (const snapshot of result.snapshots) {
      expect(Object.keys(snapshot).sort()).toEqual([...SHARED_GOAL_SNAPSHOT_KEYS].sort());
    }
  });

  it("reads each id with the verified owner uid and nothing else, one point read per goal", async () => {
    const fake = fakeGoalReader({ [OWNER_UID]: { goalA: goalData(), goalB: goalData({ title: "Second" }) } });

    await readOwnedGoalSnapshots(OWNER_UID, ["goalA", "goalB"], deps(fake.reader));

    expect(fake.calls).toEqual([
      { ownerUid: OWNER_UID, goalId: "goalA" },
      { ownerUid: OWNER_UID, goalId: "goalB" },
    ]);
  });

  it("returns no goal id anywhere in the result", async () => {
    const fake = fakeGoalReader({ [OWNER_UID]: { "goal-secret-id": goalData({ title: "Plain title" }) } });

    const result = await readOwnedGoalSnapshots(OWNER_UID, ["goal-secret-id"], deps(fake.reader));

    expect(JSON.stringify(result)).not.toContain("goal-secret-id");
  });

  it("keeps the snapshot content after the D1 goal is edited, completed, reopened or deleted", async () => {
    const fake = fakeGoalReader({ [OWNER_UID]: { goalA: goalData({ title: "Original title", targetDate: "2026-12-01" }) } });

    const result = await readOwnedGoalSnapshots(OWNER_UID, ["goalA"], deps(fake.reader));
    fake.mutate(OWNER_UID, "goalA", goalData({ title: "Edited title", status: "completed", completedAt: new Date("2026-10-02T08:00:00.000Z") }));
    expect(result).toEqual({
      ok: true,
      snapshots: [{ goalTitle: "Original title", treeId: null, targetDate: "2026-12-01", status: "active", capturedAt: NOW }],
    });

    fake.mutate(OWNER_UID, "goalA", goalData({ title: "Edited title", status: "active" }));
    fake.mutate(OWNER_UID, "goalA", null);
    expect(result).toEqual({
      ok: true,
      snapshots: [{ goalTitle: "Original title", treeId: null, targetDate: "2026-12-01", status: "active", capturedAt: NOW }],
    });
  });

  it("returns a value copy: changing the captured capturedAt Date does not change a later read", async () => {
    const fake = fakeGoalReader({ [OWNER_UID]: { goalA: goalData() } });
    const result = await readOwnedGoalSnapshots(OWNER_UID, ["goalA"], deps(fake.reader));
    if (!result.ok) throw new Error("expected success");

    result.snapshots[0].capturedAt.setUTCFullYear(1999);
    const again = await readOwnedGoalSnapshots(OWNER_UID, ["goalA"], deps(fake.reader));

    expect(again).toEqual({
      ok: true,
      snapshots: [{ goalTitle: "Lead a code review", treeId: null, targetDate: null, status: "active", capturedAt: NOW }],
    });
  });
});

describe("readOwnedGoalSnapshots — invalid selections", () => {
  it("treats another owner's goal id as absent: the store is asked for the verified owner only", async () => {
    const fake = fakeGoalReader({ [OTHER_OWNER_UID]: { foreign: goalData() } });

    const result = await readOwnedGoalSnapshots(OWNER_UID, ["foreign"], deps(fake.reader));

    expect(result).toEqual({ ok: false, error: "invalid_goal_selection" });
    expect(fake.calls).toEqual([{ ownerUid: OWNER_UID, goalId: "foreign" }]);
  });

  it("rejects an absent goal and returns nothing for a later goal in the same request", async () => {
    const fake = fakeGoalReader({ [OWNER_UID]: { goalA: goalData() } });

    const result = await readOwnedGoalSnapshots(OWNER_UID, ["goalA", "missing"], deps(fake.reader));

    expect(result).toEqual({ ok: false, error: "invalid_goal_selection" });
  });

  it.each([
    ["a malformed title with a leading space", { title: " Lead a code review" }],
    ["a title with a line break", { title: "Lead\na review" }],
    ["an empty title", { title: "" }],
    ["a title over 100 code points", { title: "x".repeat(101) }],
    ["an unknown status", { status: "archived" }],
    ["a non-date target", { targetDate: "2026-02-30" }],
    ["an empty treeId", { treeId: "" }],
    ["a non-string title", { title: 42 }],
  ])("rejects a malformed stored goal (%s) and returns nothing", async (_label, override) => {
    const fake = fakeGoalReader({ [OWNER_UID]: { goalA: goalData(override) } });

    const result = await readOwnedGoalSnapshots(OWNER_UID, ["goalA"], deps(fake.reader));

    expect(result).toEqual({ ok: false, error: "invalid_goal_selection" });
  });

  it.each([
    ["an empty list", []],
    ["six ids", ["a", "b", "c", "d", "e", "f"]],
    ["a duplicate id", ["goalA", "goalA"]],
    ["a dotted id", ["goal.A"]],
    ["a slashed id", ["goal/A"]],
    ["a double-underscore id", ["goal__A"]],
    ["an empty id", [""]],
    ["a non-string id", [7]],
    ["a non-array", "goalA"],
  ])("rejects %s before any read", async (_label, goalIds) => {
    const fake = fakeGoalReader({ [OWNER_UID]: { goalA: goalData() } });

    const result = await readOwnedGoalSnapshots(OWNER_UID, goalIds, deps(fake.reader));

    expect(result).toEqual({ ok: false, error: "invalid_goal_selection" });
    expect(fake.calls).toEqual([]);
  });

  it("accepts exactly five distinct goals", async () => {
    const ids = ["g1", "g2", "g3", "g4", "g5"];
    const seed = Object.fromEntries(ids.map((id) => [id, goalData({ title: `Goal ${id}` })]));
    const fake = fakeGoalReader({ [OWNER_UID]: seed });

    const result = await readOwnedGoalSnapshots(OWNER_UID, ids, deps(fake.reader));

    expect(result.ok).toBe(true);
    expect(fake.calls).toHaveLength(5);
  });
});

describe("readOwnedGoalSnapshots — read failures", () => {
  it("maps a store read failure to persistence_failed without leaking the store message, never to absence", async () => {
    const fake = fakeGoalReader({ [OWNER_UID]: { goalA: goalData() } });
    fake.failNextRead();

    const result = await readOwnedGoalSnapshots(OWNER_UID, ["goalA"], deps(fake.reader));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("secret path");
  });
});

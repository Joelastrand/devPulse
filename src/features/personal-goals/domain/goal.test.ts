import { describe, expect, it } from "vitest";
import {
  GOAL_DTO_KEYS,
  GOAL_LIST_RESPONSE_KEYS,
  GOAL_PERSISTED_KEYS,
  GOAL_RECOVERY_DTO_KEYS,
  isAddressableGoalId,
} from "./goal-constants";
import {
  applyGoalChange,
  createGoal,
  parseStoredGoal,
  toGoalDto,
  toGoalRecoveryDto,
  toStoredGoalData,
  type Goal,
  type GoalChange,
  type GoalListResponse,
} from "./goal";
import { normalizeGoalTitle } from "./goal-title";

const T0 = new Date("2026-10-01T10:00:00.000Z");
const T1 = new Date("2026-10-02T10:00:00.000Z");
const T2 = new Date("2026-10-03T10:00:00.000Z");

const activeDoc = () => ({ title: "Lære Rust", status: "active", createdAt: T0, updatedAt: T0 });
const completedDoc = () => ({
  ...activeDoc(),
  status: "completed",
  updatedAt: T1,
  completedAt: T1,
});

function readable(data: unknown): Goal {
  const result = parseStoredGoal(data);
  if (!result.ok) {
    throw new Error("expected a readable goal");
  }
  return result.goal;
}

describe("parseStoredGoal", () => {
  it("reads a minimal active goal", () => {
    const goal = readable(activeDoc());
    expect(goal).toEqual({ status: "active", title: "Lære Rust", createdAt: T0, updatedAt: T0 });
    expect("completedAt" in goal).toBe(false);
  });

  it("reads a completed goal with every optional field", () => {
    const goal = readable({ ...completedDoc(), treeId: "tree-1", targetDate: "2026-12-01" });
    expect(goal.status).toBe("completed");
    expect(goal.treeId).toBe("tree-1");
    expect(goal.targetDate).toBe("2026-12-01");
    expect(goal.status === "completed" && goal.completedAt).toEqual(T1);
  });

  it("treats a property explicitly set to undefined as absent", () => {
    expect(parseStoredGoal({ ...activeDoc(), treeId: undefined, completedAt: undefined }).ok).toBe(true);
  });

  it("copies timestamps so the result does not alias the input", () => {
    const doc = activeDoc();
    const goal = readable(doc);
    expect(goal.createdAt).not.toBe(doc.createdAt);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "goal"],
    ["an array", []],
    ["a number", 7],
    ["a class instance", new Date()],
  ])("rejects non-object input: %s", (_name, input) => {
    expect(parseStoredGoal(input)).toEqual({ ok: false });
  });

  it.each(["title", "status", "createdAt", "updatedAt"])("rejects a missing %s", (key) => {
    const doc: Record<string, unknown> = { ...activeDoc() };
    delete doc[key];
    expect(parseStoredGoal(doc).ok).toBe(false);
  });

  it.each([
    ["unknown key", { ...activeDoc(), note: "x" }],
    ["forbidden uid key", { ...activeDoc(), uid: "u1" }],
    ["ownerUid key", { ...activeDoc(), ownerUid: "u1" }],
    ["teamId key", { ...activeDoc(), teamId: "t1" }],
    ["areaName key", { ...activeDoc(), areaName: "Rust" }],
    ["non-string title", { ...activeDoc(), title: 5 }],
    ["non-normalised title (padding)", { ...activeDoc(), title: " Lære Rust" }],
    ["non-normalised title (double space)", { ...activeDoc(), title: "Lære  Rust" }],
    ["non-NFC title", { ...activeDoc(), title: "Bålle" }],
    ["empty title", { ...activeDoc(), title: "" }],
    ["title without letter or digit", { ...activeDoc(), title: "..." }],
    ["invalid status", { ...activeDoc(), status: "archived" }],
    ["createdAt string", { ...activeDoc(), createdAt: T0.toISOString() }],
    ["createdAt number", { ...activeDoc(), createdAt: T0.getTime() }],
    ["createdAt null", { ...activeDoc(), createdAt: null }],
    ["createdAt invalid Date", { ...activeDoc(), createdAt: new Date("nope") }],
    ["updatedAt invalid Date", { ...activeDoc(), updatedAt: new Date("nope") }],
    ["updatedAt before createdAt", { ...activeDoc(), createdAt: T1, updatedAt: T0 }],
    ["empty treeId", { ...activeDoc(), treeId: "" }],
    ["non-string treeId", { ...activeDoc(), treeId: 3 }],
    ["null treeId", { ...activeDoc(), treeId: null }],
    ["null targetDate", { ...activeDoc(), targetDate: null }],
    ["invalid targetDate", { ...activeDoc(), targetDate: "2026-02-30" }],
    ["timestamp targetDate", { ...activeDoc(), targetDate: T1 }],
    ["active with completedAt", { ...activeDoc(), completedAt: T1 }],
    ["active with null completedAt", { ...activeDoc(), completedAt: null }],
    ["completed without completedAt", { ...completedDoc(), completedAt: undefined }],
    ["completed with null completedAt", { ...completedDoc(), completedAt: null }],
    ["completed with string completedAt", { ...completedDoc(), completedAt: T1.toISOString() }],
    ["completedAt before createdAt", { ...completedDoc(), createdAt: T1, updatedAt: T1, completedAt: T0 }],
  ])("treats a document with %s as malformed", (_name, doc) => {
    expect(parseStoredGoal(doc)).toEqual({ ok: false });
  });

  it("reveals no content or reason when a document is malformed", () => {
    const result = parseStoredGoal({ ...activeDoc(), title: "secret\u0007title", note: "secret" });
    expect(JSON.stringify(result)).toBe('{"ok":false}');
  });
});

describe("createGoal", () => {
  it("creates an active goal with createdAt == updatedAt == now and no completedAt", () => {
    const goal = createGoal({ title: "Lære Rust", treeId: "t1", targetDate: "2026-12-01" }, T0);
    expect(goal).toEqual({
      status: "active",
      title: "Lære Rust",
      treeId: "t1",
      targetDate: "2026-12-01",
      createdAt: T0,
      updatedAt: T0,
    });
    expect("completedAt" in goal).toBe(false);
  });

  it("omits absent optional fields and does not alias the clock value", () => {
    const goal = createGoal({ title: "Lære Rust" }, T0);
    expect(Object.keys(goal).sort()).toEqual(["createdAt", "status", "title", "updatedAt"]);
    expect(goal.createdAt).not.toBe(T0);
    expect(goal.createdAt).not.toBe(goal.updatedAt);
  });
});

describe("applyGoalChange", () => {
  /** Successful (changed or no-op) results only; a rejection fails the test. */
  function apply(goal: Goal, change: GoalChange, now: Date) {
    const result = applyGoalChange(goal, change, now);
    if ("rejected" in result) {
      throw new Error("unexpected rejection");
    }
    return result;
  }
  const active = (): Goal => readable(activeDoc());
  const completed = (): Goal => readable(completedDoc());

  it("completes an active goal: completedAt = updatedAt = now", () => {
    const result = apply(active(), { status: "completed" }, T2);
    expect(result.changed).toBe(true);
    expect(result.goal.status).toBe("completed");
    expect(result.goal.status === "completed" && result.goal.completedAt).toEqual(T2);
    expect(result.goal.updatedAt).toEqual(T2);
    expect(result.goal.createdAt).toEqual(T0);
  });

  it("treats completing a completed goal as a no-op preserving completedAt and updatedAt", () => {
    const goal = completed();
    const result = apply(goal, { status: "completed" }, T2);
    expect(result.changed).toBe(false);
    expect(result.goal).toBe(goal);
    expect(result.goal.updatedAt).toEqual(T1);
  });

  it("reopens a completed goal: removes completedAt and sets updatedAt = now", () => {
    const result = apply(completed(), { status: "active" }, T2);
    expect(result.changed).toBe(true);
    expect(result.goal.status).toBe("active");
    expect("completedAt" in result.goal).toBe(false);
    expect(result.goal.updatedAt).toEqual(T2);
  });

  it("treats reopening an active goal as a no-op", () => {
    const goal = active();
    const result = apply(goal, { status: "active" }, T2);
    expect(result.changed).toBe(false);
    expect(result.goal.updatedAt).toEqual(T0);
  });

  it("changes only supplied fields and bumps updatedAt once", () => {
    const goal = readable({ ...activeDoc(), treeId: "t1", targetDate: "2026-12-01" });
    const result = apply(goal, { title: "Lære Go" }, T2);
    expect(result.changed).toBe(true);
    expect(result.goal).toMatchObject({
      title: "Lære Go",
      treeId: "t1",
      targetDate: "2026-12-01",
      updatedAt: T2,
      createdAt: T0,
    });
  });

  it("does not write when a title, treeId or targetDate is unchanged", () => {
    const goal = readable({ ...activeDoc(), treeId: "t1", targetDate: "2026-12-01" });
    expect(apply(goal, { title: "Lære Rust" }, T2).changed).toBe(false);
    expect(apply(goal, { treeId: "t1" }, T2).changed).toBe(false);
    expect(apply(goal, { targetDate: "2026-12-01" }, T2).changed).toBe(false);
  });

  it("removes treeId and targetDate with null, and null on an absent field is a no-op", () => {
    const goal = readable({ ...activeDoc(), treeId: "t1", targetDate: "2026-12-01" });
    const removed = apply(goal, { treeId: null, targetDate: null }, T2);
    expect(removed.changed).toBe(true);
    expect("treeId" in removed.goal).toBe(false);
    expect("targetDate" in removed.goal).toBe(false);
    expect(apply(active(), { treeId: null, targetDate: null }, T2).changed).toBe(false);
  });

  it("applies title plus a no-op status as one change with one updatedAt bump", () => {
    const result = apply(active(), { title: "Lære Go", status: "active" }, T2);
    expect(result.changed).toBe(true);
    expect(result.goal.updatedAt).toEqual(T2);
    expect(result.goal.status).toBe("active");
  });

  it("preserves completedAt when editing a completed goal", () => {
    const result = apply(completed(), { title: "Lære Go", targetDate: "2027-01-01" }, T2);
    expect(result.changed).toBe(true);
    expect(result.goal.status === "completed" && result.goal.completedAt).toEqual(T1);
    expect(result.goal.updatedAt).toEqual(T2);
  });

  it("completes and edits in one change using a single timestamp", () => {
    const result = apply(active(), { title: "Lære Go", status: "completed" }, T2);
    expect(result.goal.status === "completed" && result.goal.completedAt).toEqual(T2);
    expect(result.goal.updatedAt).toEqual(T2);
  });

  it("does not mutate the input goal", () => {
    const goal = active();
    apply(goal, { title: "Lære Go", status: "completed" }, T2);
    expect(goal).toEqual({ status: "active", title: "Lære Rust", createdAt: T0, updatedAt: T0 });
  });

  it("always yields a goal the parser accepts (BR-6 invariant)", () => {
    const changes = [
      { status: "completed" as const },
      { status: "active" as const },
      { title: "Lære Go" },
      { treeId: "t9", status: "completed" as const },
    ];
    for (const start of [active(), completed()]) {
      for (const change of changes) {
        const next = apply(start, change, T2).goal;
        expect(parseStoredGoal(toStoredGoalData(next)).ok).toBe(true);
      }
    }
  });

  describe("clock regression (BR-64)", () => {
    // Canonical goals created/last written at T1; the supplied clock T0 < T1.
    const at1Active = (): Goal =>
      readable({ ...activeDoc(), createdAt: T1, updatedAt: T1, treeId: "t1", targetDate: "2026-12-01" });
    const at1Completed = (): Goal =>
      readable({
        ...activeDoc(),
        status: "completed",
        createdAt: T1,
        updatedAt: T1,
        completedAt: T1,
        treeId: "t1",
        targetDate: "2026-12-01",
      });
    const rejection = { changed: false, rejected: "clock_regressed" };

    it.each([
      ["changed title", { title: "Lære Go" }, at1Active],
      ["changed treeId", { treeId: "t2" }, at1Active],
      ["removed treeId", { treeId: null }, at1Active],
      ["changed targetDate", { targetDate: "2027-01-01" }, at1Active],
      ["removed targetDate", { targetDate: null }, at1Active],
      ["active → completed", { status: "completed" as const }, at1Active],
      ["completed → active", { status: "active" as const }, at1Completed],
      ["edit + completion", { title: "Lære Go", status: "completed" as const }, at1Active],
      ["edit + reopen", { title: "Lære Go", status: "active" as const }, at1Completed],
      ["edit of a completed goal", { title: "Lære Go" }, at1Completed],
    ])("rejects %s when now < createdAt, atomically and without mutating", (_n, change, make) => {
      const goal = make();
      const snapshot = structuredClone(goal);
      const result = applyGoalChange(goal, change, T0);
      expect(result).toEqual(rejection);
      expect("goal" in result).toBe(false);
      expect(goal).toEqual(snapshot);
      expect(goal.updatedAt).toEqual(T1);
    });

    it("rejects with a content-free failure (no title, raw field or goal)", () => {
      const result = applyGoalChange(at1Active(), { title: "Hemmelig" }, T0);
      expect(Object.keys(result)).toEqual(["changed", "rejected"]);
      expect(JSON.stringify(result)).not.toMatch(/Hemmelig|Lære|t1|2026/);
    });

    it("fails closed on an invalid supplied time", () => {
      expect(applyGoalChange(at1Active(), { title: "Lære Go" }, new Date(Number.NaN))).toEqual(rejection);
    });

    it("no-op precedence: a regressed clock still yields the ordinary no-op", () => {
      const completedGoal = at1Completed();
      const activeGoal = at1Active();
      const same = (r: ReturnType<typeof applyGoalChange>, g: Goal) => {
        expect(r).toEqual({ changed: false, goal: g });
        expect("goal" in r && r.goal).toBe(g);
      };
      same(applyGoalChange(completedGoal, { status: "completed" }, T0), completedGoal);
      same(applyGoalChange(activeGoal, { status: "active" }, T0), activeGoal);
      // Operation code normalises the title first (BR-9); it then equals the stored one.
      const normalized = normalizeGoalTitle("  Lære   Rust ");
      expect(normalized).toEqual({ ok: true, title: "Lære Rust" });
      same(applyGoalChange(activeGoal, { title: normalized.ok ? normalized.title : "" }, T0), activeGoal);
      same(applyGoalChange(activeGoal, { treeId: "t1" }, T0), activeGoal);
      same(applyGoalChange(activeGoal, { targetDate: "2026-12-01" }, T0), activeGoal);
      same(applyGoalChange(completedGoal, { status: "completed", treeId: "t1" }, T0), completedGoal);
    });

    it("a repeated completion carrying another edit is a changed mutation and is rejected", () => {
      expect(applyGoalChange(at1Completed(), { status: "completed", title: "Lære Go" }, T0)).toEqual(rejection);
    });

    it("allows now === createdAt and a later now", () => {
      const equal = apply(at1Active(), { status: "completed" }, T1);
      expect(equal.changed).toBe(true);
      expect(equal.goal.updatedAt).toEqual(T1);
      expect(equal.goal.status === "completed" && equal.goal.completedAt).toEqual(T1);
      const later = apply(at1Active(), { title: "Lære Go" }, T2);
      expect(later.goal.updatedAt).toEqual(T2);
    });

    it("never produces an unreadable goal for any change and any clock (round trip)", () => {
      const changes: GoalChange[] = [
        {},
        { title: "Lære Go" },
        { title: "Lære Rust" },
        { treeId: "t9" },
        { treeId: null },
        { targetDate: "2027-01-01" },
        { targetDate: null },
        { status: "completed" },
        { status: "active" },
        { title: "Lære Go", status: "completed" },
        { title: "Lære Go", status: "active" },
      ];
      const clocks = [T0, T1, T2, new Date(Number.NaN)];
      for (const start of [at1Active(), at1Completed()]) {
        for (const change of changes) {
          for (const now of clocks) {
            const result = applyGoalChange(start, change, now);
            if ("rejected" in result) {
              continue;
            }
            expect(parseStoredGoal(toStoredGoalData(result.goal)).ok).toBe(true);
          }
        }
      }
    });
  });
});

describe("toStoredGoalData", () => {
  it("emits exactly the persisted keys, with completedAt only when completed", () => {
    const full = toStoredGoalData(readable({ ...completedDoc(), treeId: "t1", targetDate: "2026-12-01" }));
    expect(Object.keys(full).sort()).toEqual([...GOAL_PERSISTED_KEYS].sort());

    const minimal = toStoredGoalData(readable(activeDoc()));
    expect(Object.keys(minimal).sort()).toEqual(["createdAt", "status", "title", "updatedAt"]);
  });

  it("never carries owner, team, role, score or derived-area fields", () => {
    const keys = Object.keys(toStoredGoalData(readable(completedDoc())));
    for (const forbidden of ["uid", "ownerUid", "teamId", "memberRef", "email", "areaName", "schemaVersion"]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe("toGoalDto", () => {
  it("builds exactly the BR-24 keys with ISO timestamps (no tree)", () => {
    const dto = toGoalDto("g1", readable(activeDoc()), "ignored");
    expect(Object.keys(dto).sort()).toEqual([...GOAL_DTO_KEYS].sort());
    expect(dto).toEqual({
      id: "g1",
      title: "Lære Rust",
      status: "active",
      treeId: null,
      areaName: null,
      areaAvailable: true,
      targetDate: null,
      createdAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-01T10:00:00.000Z",
      completedAt: null,
    });
  });

  it("includes the resolved area name for an available tree", () => {
    const dto = toGoalDto("g1", readable({ ...completedDoc(), treeId: "t1", targetDate: "2026-12-01" }), "Rust");
    expect(dto).toMatchObject({
      treeId: "t1",
      areaName: "Rust",
      areaAvailable: true,
      targetDate: "2026-12-01",
      completedAt: "2026-10-02T10:00:00.000Z",
    });
  });

  it("marks a stored but unavailable tree as areaAvailable false without dropping treeId", () => {
    const dto = toGoalDto("g1", readable({ ...activeDoc(), treeId: "gone" }), null);
    expect(dto).toMatchObject({ treeId: "gone", areaName: null, areaAvailable: false });
  });
});

describe("recovery DTO and response contract", () => {
  it("GoalRecoveryDto is exactly { goalId }", () => {
    expect(toGoalRecoveryDto("g1")).toEqual({ goalId: "g1" });
    expect(Object.keys(toGoalRecoveryDto("g1"))).toEqual([...GOAL_RECOVERY_DTO_KEYS]);
  });

  it("a recovery item has no field that could carry malformed content", () => {
    const keys: readonly string[] = GOAL_RECOVERY_DTO_KEYS;
    for (const forbidden of ["title", "treeId", "targetDate", "status", "createdAt", "updatedAt", "completedAt", "uid", "ownerUid", "teamId"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("the GET envelope key tuple matches the type", () => {
    const envelope: GoalListResponse = {
      goals: [],
      recoveryItems: [],
      truncated: false,
      skillOptions: [],
      skillOptionsTruncated: false,
    };
    expect(Object.keys(envelope).sort()).toEqual([...GOAL_LIST_RESPONSE_KEYS].sort());
  });

  it("persisted keys exclude every forbidden field", () => {
    const keys: readonly string[] = GOAL_PERSISTED_KEYS;
    expect(keys).toHaveLength(7);
    for (const forbidden of ["uid", "ownerUid", "email", "displayName", "teamId", "memberRef", "score", "areaName", "schemaVersion"]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe("isAddressableGoalId", () => {
  it.each(["abc", "x", "_", "-", "A1_-z", "_a", "a_", "__a", "a__", "a".repeat(128), "x".repeat(20)])("accepts %s", (id) => {
    expect(isAddressableGoalId(id)).toBe(true);
  });

  it.each(["", "a/b", ".", "..", "a.b", "a b", " a", "a\n", "é", "__x__", "__foo__", "____", "a".repeat(129), 5, null, undefined])(
    "rejects %j",
    (id) => {
      expect(isAddressableGoalId(id)).toBe(false);
    },
  );
});

import { describe, expect, it } from "vitest";
import {
  groupRoadmapTimeline,
  quarterOf,
  type RoadmapTimelineGroup,
  type RoadmapTimelinePlan,
} from "./roadmap-timeline";

type TestPlan = RoadmapTimelinePlan;

function plan(treeId: string, overrides: Partial<TestPlan> = {}): TestPlan {
  return {
    archived: false,
    status: "planned",
    priority: "medium",
    startDate: null,
    targetDate: null,
    areaName: "Område",
    treeId,
    overdue: false,
    completedAt: null,
    ...overrides,
  };
}

function ids(group: RoadmapTimelineGroup<TestPlan> | undefined): string[] {
  return group ? group.items.map((p) => p.treeId) : [];
}

function find(groups: RoadmapTimelineGroup<TestPlan>[], kind: string, key?: string) {
  return groups.find((g) => g.kind === kind && (key === undefined || (g.kind === "quarter" && g.quarter.key === key)));
}

function kindsOf(plans: TestPlan[], treeId: string): string[] {
  return groupRoadmapTimeline(plans)
    .filter((g) => ids(g).includes(treeId))
    .map((g) => (g.kind === "quarter" ? g.quarter.key : g.kind));
}

describe("quarterOf", () => {
  it.each([
    ["2026-01-01", 2026, 1],
    ["2026-03-31", 2026, 1],
    ["2026-04-01", 2026, 2],
    ["2026-06-30", 2026, 2],
    ["2026-07-01", 2026, 3],
    ["2026-09-30", 2026, 3],
    ["2026-10-01", 2026, 4],
    ["2026-12-31", 2026, 4],
    ["2027-01-01", 2027, 1],
  ])("%s is year %i quarter %i", (date, year, quarter) => {
    expect(quarterOf(date)).toMatchObject({ year, quarter });
  });

  it("has a stable sortable key and Norwegian label", () => {
    expect(quarterOf("2026-11-15")).toEqual({ year: 2026, quarter: 4, key: "2026-Q4", label: "4. kvartal 2026" });
    expect(quarterOf("2026-12-31").key < quarterOf("2027-01-01").key).toBe(true);
  });

  it("rejects non-ISO input instead of guessing", () => {
    expect(() => quarterOf("2026-13-01")).toThrow();
    expect(() => quarterOf("31.12.2026")).toThrow();
  });

  it.each(["2026-02-30", "2026-04-31", "2026-05-00", "2026-00-10", "2019-12-31", "2101-01-01", "2026-1-01"])(
    "rejects %s with the canonical plan-date validation",
    (date) => {
      expect(() => quarterOf(date)).toThrow();
    },
  );

  it("accepts the canonical year range edges", () => {
    expect(quarterOf("2020-01-01").key).toBe("2020-Q1");
    expect(quarterOf("2100-12-31").key).toBe("2100-Q4");
  });
});

describe("groupRoadmapTimeline classification (first match wins)", () => {
  it("archived wins over completed, overdue and targetDate", () => {
    const p = plan("a", { archived: true, status: "completed", overdue: true, targetDate: "2026-05-01", completedAt: "2026-01-01T00:00:00.000Z" });
    expect(kindsOf([p], "a")).toEqual(["archived"]);
  });

  it("archived legacy completed plan (completedAt null) is only Arkiverte", () => {
    expect(kindsOf([plan("a", { archived: true, status: "completed" })], "a")).toEqual(["archived"]);
  });

  it("archived + overdue and archived alone are only Arkiverte", () => {
    expect(kindsOf([plan("a", { archived: true, overdue: true })], "a")).toEqual(["archived"]);
    expect(kindsOf([plan("a", { archived: true, targetDate: "2026-05-01" })], "a")).toEqual(["archived"]);
  });

  it("completed wins over overdue flag and targetDate", () => {
    expect(kindsOf([plan("a", { status: "completed", overdue: true, completedAt: "2026-01-01T00:00:00.000Z" })], "a")).toEqual(["completed"]);
    expect(kindsOf([plan("a", { status: "completed", targetDate: "2026-05-01", startDate: "2026-01-01" })], "a")).toEqual(["completed"]);
  });

  it("legacy completed plan with completedAt null stays in Fullførte", () => {
    expect(kindsOf([plan("a", { status: "completed", completedAt: null, targetDate: "2026-05-01" })], "a")).toEqual(["completed"]);
  });

  it("incomplete overdue (with or without targetDate) is only Forfalt", () => {
    expect(kindsOf([plan("a", { status: "active", overdue: true })], "a")).toEqual(["overdue"]);
    expect(kindsOf([plan("a", { overdue: true, targetDate: "2026-02-01", startDate: "2026-01-01" })], "a")).toEqual(["overdue"]);
  });

  it("targetDate (with or without startDate) groups by the target quarter only", () => {
    expect(kindsOf([plan("a", { targetDate: "2026-11-01" })], "a")).toEqual(["2026-Q4"]);
    expect(kindsOf([plan("a", { targetDate: "2026-11-01", startDate: "2026-01-10" })], "a")).toEqual(["2026-Q4"]);
  });

  it("startDate without targetDate is Kun startdato; no dates is Uten dato", () => {
    expect(kindsOf([plan("a", { startDate: "2026-01-10" })], "a")).toEqual(["start-only"]);
    expect(kindsOf([plan("a")], "a")).toEqual(["undated"]);
  });

  it("returns no groups for empty input and omits empty groups", () => {
    expect(groupRoadmapTimeline([])).toEqual([]);
    expect(groupRoadmapTimeline([plan("a")]).map((g) => g.kind)).toEqual(["undated"]);
  });
});

// One representative of every class, including every overlap.
function representatives(): TestPlan[] {
  const done = "2026-02-01T10:00:00.000Z";
  return [
    plan("archived", { archived: true }),
    plan("archived-completed", { archived: true, status: "completed", completedAt: done }),
    plan("archived-overdue", { archived: true, overdue: true, targetDate: "2026-01-05" }),
    plan("archived-legacy", { archived: true, status: "completed" }),
    plan("completed", { status: "completed", completedAt: done }),
    plan("completed-overdue", { status: "completed", overdue: true, completedAt: done }),
    plan("completed-target", { status: "completed", targetDate: "2026-05-01", completedAt: done }),
    plan("completed-legacy", { status: "completed", completedAt: null }),
    plan("overdue", { overdue: true }),
    plan("overdue-target", { overdue: true, targetDate: "2026-01-31" }),
    plan("target", { targetDate: "2026-11-01" }),
    plan("target-start", { targetDate: "2026-11-02", startDate: "2026-01-01" }),
    plan("start", { startDate: "2026-03-01" }),
    plan("none"),
  ];
}

const EXPECTED_GROUP: Record<string, string> = {
  archived: "archived",
  "archived-completed": "archived",
  "archived-overdue": "archived",
  "archived-legacy": "archived",
  completed: "completed",
  "completed-overdue": "completed",
  "completed-target": "completed",
  "completed-legacy": "completed",
  overdue: "overdue",
  "overdue-target": "overdue",
  target: "2026-Q4",
  "target-start": "2026-Q4",
  start: "start-only",
  none: "undated",
};

function permutations<T>(items: T[]): T[][] {
  // Deterministic set: rotations, reversal and an interleave — enough to break
  // any order-dependent classifier without factorial blow-up.
  const rotations = items.map((_, i) => [...items.slice(i), ...items.slice(0, i)]);
  const reversed = [...items].reverse();
  const reversedRotations = reversed.map((_, i) => [...reversed.slice(i), ...reversed.slice(0, i)]);
  const interleaved = [...items.filter((_, i) => i % 2 === 0), ...items.filter((_, i) => i % 2 === 1)];
  return [...rotations, ...reversedRotations, interleaved];
}

describe("groupRoadmapTimeline partition", () => {
  it("places every plan in exactly one group matching first-match precedence, for any input order", () => {
    const all = representatives();
    for (const input of permutations(all)) {
      const groups = groupRoadmapTimeline(input);
      const flat = groups.flatMap((g) => g.items.map((p) => p.treeId));

      expect(flat).toHaveLength(input.length);
      expect([...flat].sort()).toEqual(all.map((p) => p.treeId).sort());
      expect(new Set(flat).size).toBe(flat.length);

      for (const group of groups) {
        const key = group.kind === "quarter" ? group.quarter.key : group.kind;
        for (const item of group.items) expect(EXPECTED_GROUP[item.treeId]).toBe(key);
      }
    }
  });

  it("covers the full archived × completed × overdue × date-shape truth table exactly once", () => {
    const dateShapes = [
      {},
      { startDate: "2026-01-01" },
      { targetDate: "2026-08-15" },
      { startDate: "2026-01-01", targetDate: "2026-08-15" },
    ];
    const truthTable: TestPlan[] = [];
    let n = 0;
    for (const archived of [false, true])
      for (const completed of [false, true])
        for (const overdue of [false, true])
          for (const dates of dateShapes)
            truthTable.push(
              plan(`row-${n++}`, {
                archived,
                overdue,
                status: completed ? "completed" : "active",
                completedAt: completed ? "2026-02-01T00:00:00.000Z" : null,
                ...dates,
              }),
            );

    const groups = groupRoadmapTimeline(truthTable);
    const flat = groups.flatMap((g) => g.items.map((p) => p.treeId));
    expect(flat).toHaveLength(truthTable.length);
    expect(new Set(flat).size).toBe(truthTable.length);

    for (const group of groups) {
      for (const item of group.items) {
        const expected = item.archived
          ? "archived"
          : item.status === "completed"
            ? "completed"
            : item.overdue
              ? "overdue"
              : item.targetDate
                ? "quarter"
                : item.startDate
                  ? "start-only"
                  : "undated";
        expect(group.kind).toBe(expected);
      }
    }
  });

  it("does not mutate the caller's array or its items", () => {
    const input = representatives().reverse();
    const snapshot = input.map((p) => p.treeId);
    const copies = input.map((p) => ({ ...p }));
    groupRoadmapTimeline(input);
    expect(input.map((p) => p.treeId)).toEqual(snapshot);
    expect(input).toEqual(copies);
  });
});

describe("groupRoadmapTimeline ordering", () => {
  it("orders groups: Forfalt, quarters ascending, Kun startdato, Uten dato, Fullførte, Arkiverte", () => {
    const groups = groupRoadmapTimeline([
      ...representatives(),
      plan("q-2026-2", { targetDate: "2026-04-01" }),
      plan("q-2027-1", { targetDate: "2027-01-01" }),
      plan("q-2025-4", { targetDate: "2025-12-31" }),
    ]);
    expect(groups.map((g) => (g.kind === "quarter" ? g.quarter.key : g.kind))).toEqual([
      "overdue",
      "2025-Q4",
      "2026-Q2",
      "2026-Q4",
      "2027-Q1",
      "start-only",
      "undated",
      "completed",
      "archived",
    ]);
  });

  it("is identical for every input permutation", () => {
    const base = [
      ...representatives(),
      plan("t-same-1", { targetDate: "2026-11-01", priority: "high" }),
      plan("t-same-2", { targetDate: "2026-11-01", priority: "high" }),
      plan("t-same-3", { targetDate: "2026-11-01", priority: "high", areaName: null }),
    ];
    const expected = JSON.stringify(groupRoadmapTimeline(base));
    for (const input of permutations(base)) expect(JSON.stringify(groupRoadmapTimeline(input))).toBe(expected);
  });

  it("Forfalt: targetDate ascending, then compareRoadmapPlans (priority, …, treeId)", () => {
    const groups = groupRoadmapTimeline([
      plan("late", { overdue: true, targetDate: "2026-03-01" }),
      plan("early-low", { overdue: true, targetDate: "2026-01-01", priority: "low" }),
      plan("early-high", { overdue: true, targetDate: "2026-01-01", priority: "high" }),
      plan("early-high-b", { overdue: true, targetDate: "2026-01-01", priority: "high" }),
    ]);
    expect(ids(find(groups, "overdue"))).toEqual(["early-high", "early-high-b", "early-low", "late"]);
  });

  it("Target quarter: targetDate ascending (not startDate), ties by compareRoadmapPlans", () => {
    const groups = groupRoadmapTimeline([
      plan("b", { targetDate: "2026-12-01", startDate: "2026-10-01" }),
      plan("a", { targetDate: "2026-10-05", startDate: "2026-10-04" }),
      plan("tie-2", { targetDate: "2026-11-01", priority: "low" }),
      plan("tie-1", { targetDate: "2026-11-01", priority: "high" }),
    ]);
    expect(ids(find(groups, "quarter", "2026-Q4"))).toEqual(["a", "tie-1", "tie-2", "b"]);
  });

  it("Kun startdato: startDate ascending, ties by compareRoadmapPlans", () => {
    const groups = groupRoadmapTimeline([
      plan("late", { startDate: "2026-05-01" }),
      plan("tie-b", { startDate: "2026-02-01" }),
      plan("tie-a", { startDate: "2026-02-01" }),
      plan("early-low", { startDate: "2026-01-01", priority: "low" }),
    ]);
    expect(ids(find(groups, "start-only"))).toEqual(["early-low", "tie-a", "tie-b", "late"]);
  });

  it("Uten dato and Arkiverte use compareRoadmapPlans order", () => {
    const groups = groupRoadmapTimeline([
      plan("u-b"),
      plan("u-a"),
      plan("u-high", { priority: "high" }),
      plan("x-planned", { archived: true }),
      plan("x-active", { archived: true, status: "active" }),
      plan("x-done", { archived: true, status: "completed" }),
    ]);
    expect(ids(find(groups, "undated"))).toEqual(["u-high", "u-a", "u-b"]);
    expect(ids(find(groups, "archived"))).toEqual(["x-active", "x-planned", "x-done"]);
  });

  it("Fullførte: completedAt descending, null last, then compareRoadmapPlans", () => {
    const groups = groupRoadmapTimeline([
      plan("legacy-b", { status: "completed", completedAt: null }),
      plan("old", { status: "completed", completedAt: "2026-01-01T00:00:00.000Z" }),
      plan("legacy-a", { status: "completed", completedAt: null }),
      plan("new-low", { status: "completed", completedAt: "2026-03-01T00:00:00.000Z", priority: "low" }),
      plan("new-high", { status: "completed", completedAt: "2026-03-01T00:00:00.000Z", priority: "high" }),
    ]);
    expect(ids(find(groups, "completed"))).toEqual(["new-high", "new-low", "old", "legacy-a", "legacy-b"]);
  });

  it("quarter boundary: Mar 31 and Apr 1 land in different consecutive groups", () => {
    const groups = groupRoadmapTimeline([
      plan("apr", { targetDate: "2026-04-01" }),
      plan("mar", { targetDate: "2026-03-31" }),
      plan("jan", { targetDate: "2027-01-01" }),
      plan("dec", { targetDate: "2026-12-31" }),
    ]);
    const quarters = groups.flatMap((g) => (g.kind === "quarter" ? [[g.quarter.key, ids(g)] as const] : []));
    expect(quarters).toEqual([
      ["2026-Q1", ["mar"]],
      ["2026-Q2", ["apr"]],
      ["2026-Q4", ["dec"]],
      ["2027-Q1", ["jan"]],
    ]);
  });
});

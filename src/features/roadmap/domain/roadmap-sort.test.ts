import { describe, expect, it } from "vitest";
import { compareRoadmapPlans, orderAreasForPlanning, type RoadmapSortKey } from "./roadmap-sort";

function plan(overrides: Partial<RoadmapSortKey> = {}): RoadmapSortKey {
  return {
    archived: false,
    status: "planned",
    priority: "medium",
    targetDate: null,
    startDate: null,
    areaName: "Test",
    treeId: "t1",
    ...overrides,
  };
}

function sorted(plans: RoadmapSortKey[]): RoadmapSortKey[] {
  return [...plans].sort(compareRoadmapPlans);
}

describe("compareRoadmapPlans", () => {
  it("puts non-archived before archived regardless of other fields", () => {
    const result = sorted([plan({ archived: true, status: "active", priority: "high" }), plan({ status: "completed", priority: "low" })]);
    expect(result.map((p) => p.archived)).toEqual([false, true]);
  });

  it("ranks status active < planned < completed", () => {
    const result = sorted([plan({ status: "completed" }), plan({ status: "planned" }), plan({ status: "active" })]);
    expect(result.map((p) => p.status)).toEqual(["active", "planned", "completed"]);
  });

  it("ranks priority high < medium < low within a status", () => {
    const result = sorted([plan({ priority: "low" }), plan({ priority: "high" }), plan({ priority: "medium" })]);
    expect(result.map((p) => p.priority)).toEqual(["high", "medium", "low"]);
  });

  it("sorts target date ascending with absent last", () => {
    const result = sorted([plan({ targetDate: null, treeId: "a" }), plan({ targetDate: "2026-09-01", treeId: "b" }), plan({ targetDate: "2026-07-01", treeId: "c" })]);
    expect(result.map((p) => p.treeId)).toEqual(["c", "b", "a"]);
  });

  it("then sorts start date ascending with absent last", () => {
    const result = sorted([plan({ startDate: null, treeId: "a" }), plan({ startDate: "2026-08-01", treeId: "b" }), plan({ startDate: "2026-06-01", treeId: "c" })]);
    expect(result.map((p) => p.treeId)).toEqual(["c", "b", "a"]);
  });

  it("then sorts by area name using Norwegian collation (Å after Z), then treeId", () => {
    const result = sorted([plan({ areaName: "Å-område", treeId: "1" }), plan({ areaName: "Zebra", treeId: "2" }), plan({ areaName: "Alfa", treeId: "9" }), plan({ areaName: "Alfa", treeId: "3" })]);
    expect(result.map((p) => p.treeId)).toEqual(["3", "9", "2", "1"]);
  });

  it("sorts an unresolved (null) area name after every named area, then by treeId", () => {
    const result = sorted([
      plan({ areaName: null, treeId: "1" }),
      plan({ areaName: "Å-område", treeId: "2" }),
      plan({ areaName: null, treeId: "0" }),
      plan({ areaName: "Alfa", treeId: "3" }),
    ]);
    expect(result.map((p) => p.treeId)).toEqual(["3", "2", "0", "1"]);
  });

  it("is deterministic regardless of input order", () => {
    const input = [plan({ treeId: "a", priority: "low" }), plan({ treeId: "b", status: "active" }), plan({ treeId: "c", archived: true })];
    expect(sorted([...input].reverse())).toEqual(sorted(input));
  });
});

describe("orderAreasForPlanning", () => {
  const areas = [
    { treeId: "t-z", name: "Zeta" },
    { treeId: "t-a", name: "Alfa" },
    { treeId: "t-m", name: "Mu" },
    { treeId: "t-b", name: "Beta" },
  ];

  it("lists areas with a non-archived plan first in plan order, then the rest by name", () => {
    const plans = [
      { archived: false, status: "planned" as const, priority: "low" as const, treeId: "t-z" },
      { archived: false, status: "active" as const, priority: "high" as const, treeId: "t-m" },
    ];
    expect(orderAreasForPlanning(areas, plans).map((a) => a.treeId)).toEqual(["t-m", "t-z", "t-a", "t-b"]);
  });

  it("does not lift an area whose only plan is archived", () => {
    const plans = [{ archived: true, status: "active" as const, priority: "high" as const, treeId: "t-z" }];
    expect(orderAreasForPlanning(areas, plans).map((a) => a.treeId)).toEqual(["t-a", "t-b", "t-m", "t-z"]);
  });

  it("breaks equal names by treeId and does not mutate its input", () => {
    const dup = [
      { treeId: "2", name: "Same" },
      { treeId: "1", name: "Same" },
    ];
    const snapshot = [...dup];
    expect(orderAreasForPlanning(dup, []).map((a) => a.treeId)).toEqual(["1", "2"]);
    expect(dup).toEqual(snapshot);
  });
});

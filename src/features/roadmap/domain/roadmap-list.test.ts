import { describe, expect, it } from "vitest";
import { archivedRoadmapList, groupRoadmapList, type RoadmapListItem } from "./roadmap-list";

function item(overrides: Partial<RoadmapListItem> = {}): RoadmapListItem {
  return {
    archived: false,
    status: "active",
    priority: "medium",
    targetDate: null,
    startDate: null,
    areaName: "Area",
    treeId: "t",
    ...overrides,
  };
}

describe("groupRoadmapList", () => {
  it("groups by status in active, planned, completed order and omits empty groups", () => {
    const groups = groupRoadmapList([
      item({ treeId: "c", status: "completed" }),
      item({ treeId: "a", status: "active" }),
    ]);
    expect(groups.map((g) => g.status)).toEqual(["active", "completed"]);
  });

  it("orders each group with compareRoadmapPlans (priority, then target date)", () => {
    const [group] = groupRoadmapList([
      item({ treeId: "low", priority: "low" }),
      item({ treeId: "late", priority: "high", targetDate: "2026-09-01" }),
      item({ treeId: "early", priority: "high", targetDate: "2026-03-01" }),
    ]);
    expect(group.items.map((i) => i.treeId)).toEqual(["early", "late", "low"]);
  });

  it("excludes archived plans without mutating the canonical input", () => {
    const input = [item({ treeId: "live" }), item({ treeId: "old", archived: true })];
    const groups = groupRoadmapList(input);
    expect(groups.flatMap((g) => g.items.map((i) => i.treeId))).toEqual(["live"]);
    expect(input.map((i) => i.treeId)).toEqual(["live", "old"]);
  });

  it("returns no groups when every plan is archived", () => {
    expect(groupRoadmapList([item({ archived: true })])).toEqual([]);
  });
});

describe("archivedRoadmapList", () => {
  it("returns only archived plans of any status in compareRoadmapPlans order (status before priority) without mutating the input", () => {
    const input = [
      item({ treeId: "live" }),
      item({ treeId: "low", archived: true, priority: "low" }),
      item({ treeId: "done", archived: true, status: "completed", priority: "high" }),
    ];
    expect(archivedRoadmapList(input).map((i) => i.treeId)).toEqual(["low", "done"]);
    expect(input.map((i) => i.treeId)).toEqual(["live", "low", "done"]);
  });
});

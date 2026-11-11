import { describe, expect, it } from "vitest";
import type { AutomaticSkillLevelRow } from "./automatic-profile";
import { automaticOverviewAreas, collaborativeOverviewAreas, priorityGroups, type OverviewArea } from "./overview-areas";

/** Synthetic fixtures only. */
const none = new Set<string>();

describe("automaticOverviewAreas", () => {
  it("takes levels only from value rows and never turns a withheld value into zero", () => {
    const rows: AutomaticSkillLevelRow[] = [
      { treeId: "a", areaName: "Område A", targetLevel: 3, state: "value", level: 2 },
      { treeId: "b", areaName: "Område B", targetLevel: 3, state: "insufficient_data" },
      { treeId: "c", areaName: null, targetLevel: 2, state: "area_unavailable" },
    ];
    const areas = automaticOverviewAreas(rows, new Set(["a"]));
    expect(areas).toEqual([
      { treeId: "a", name: "Område A", level: 2, levelState: "value", target: 3, hasPlan: true },
      { treeId: "b", name: "Område B", level: null, levelState: "insufficient_data", target: 3, hasPlan: false },
      { treeId: "c", name: null, level: null, levelState: "unavailable", target: 2, hasPlan: false },
    ]);
  });
});

describe("collaborativeOverviewAreas", () => {
  const activeAreas = [
    { treeId: "a", name: "Område A" },
    { treeId: "b", name: "Område B" },
  ];

  it("marks an area without an entered level as not set, not zero", () => {
    const areas = collaborativeOverviewAreas({
      activeAreas,
      levelByTree: new Map([["a", 3]]),
      levelsAvailable: true,
      targets: new Map([["a", 3], ["b", 2]]),
      plannedTreeIds: none,
    });
    expect(areas.map((area) => [area.level, area.levelState])).toEqual([
      [3, "value"],
      [null, "not_set"],
    ]);
  });

  it("marks every level unavailable when the level source failed", () => {
    const areas = collaborativeOverviewAreas({
      activeAreas,
      levelByTree: new Map(),
      levelsAvailable: false,
      targets: null,
      plannedTreeIds: none,
    });
    expect(areas.every((area) => area.levelState === "unavailable" && area.level === null && area.target === null)).toBe(true);
  });
});

describe("priorityGroups", () => {
  const area = (treeId: string, level: number | null, target: number | null, levelState: OverviewArea["levelState"]): OverviewArea => ({
    treeId,
    name: treeId,
    level,
    levelState,
    target,
    hasPlan: false,
  });

  it("lists only confirmed gaps, largest gap first, and keeps missing data out of the gaps", () => {
    const groups = priorityGroups([
      area("near", 2, 3, "value"),
      area("under", 1, 4, "value"),
      area("awaiting", null, 3, "insufficient_data"),
      area("notTarget", 2, null, "value"),
      area("met", 3, 3, "value"),
    ]);
    expect(groups.gaps.map((item) => item.treeId)).toEqual(["under", "near"]);
    expect(groups.awaitingData.map((item) => item.treeId)).toEqual(["awaiting"]);
    expect(groups.withoutTarget).toBe(1);
  });

  it("reports no gaps when nothing is confirmed below target, instead of treating missing data as a gap", () => {
    const groups = priorityGroups([area("awaiting", null, 3, "not_set")]);
    expect(groups.gaps).toEqual([]);
    expect(groups.awaitingData).toHaveLength(1);
  });
});

import { areaStatus, type AreaStatus } from "./area-status";
import type { AutomaticSkillLevelRow } from "./automatic-profile";

/**
 * Why a team level is or is not shown. `null` level is never rendered as zero: each non-value state has its own label.
 * - `value`: the team level is available (collaborative level, or automatic value that passed the k gate).
 * - `not_set`: collaborative mode, no level entered by teamadmin yet.
 * - `insufficient_data`: automatic mode, fewer contributors than the k = 3 publication gate.
 * - `unavailable`: the level source could not be read, or the area can no longer be read.
 */
export type OverviewLevelState = "value" | "not_set" | "insufficient_data" | "unavailable";

/**
 * One row of the Teamkompetanse overview. Every presentation (radar summary, donut, key figures, area list and priorities)
 * is derived from one list of these, so they cannot disagree.
 */
export interface OverviewArea {
  readonly treeId: string;
  readonly name: string | null;
  readonly level: number | null;
  readonly levelState: OverviewLevelState;
  readonly target: number | null;
  readonly hasPlan: boolean;
}

/** Shared "gap to target" ordering: larger gap first. Only meaningful for areas whose level and target are both set. */
export function gapOf(area: Pick<OverviewArea, "level" | "target">): number {
  return (area.target ?? 0) - (area.level ?? 0);
}

export function statusOf(area: Pick<OverviewArea, "level" | "target">): AreaStatus {
  return areaStatus(area.level, area.target);
}

/**
 * Collaborative mode: the collection is the team's active assigned areas. Levels come from the teamadmin-entered map,
 * targets from the team's needs (`null` when the needs read did not provide one).
 */
export function collaborativeOverviewAreas(input: {
  readonly activeAreas: readonly { readonly treeId: string; readonly name: string | null }[];
  readonly levelByTree: ReadonlyMap<string, number>;
  readonly levelsAvailable: boolean;
  readonly targets: ReadonlyMap<string, number> | null;
  readonly plannedTreeIds: ReadonlySet<string>;
}): OverviewArea[] {
  return input.activeAreas.map((area) => {
    const level = input.levelByTree.get(area.treeId) ?? null;
    let levelState: OverviewLevelState = "unavailable";
    if (input.levelsAvailable) levelState = level === null ? "not_set" : "value";
    return {
      treeId: area.treeId,
      name: area.name,
      level,
      levelState,
      target: input.targets?.get(area.treeId) ?? null,
      hasPlan: input.plannedTreeIds.has(area.treeId),
    };
  });
}

/**
 * Automatic mode: the collection is the numeric rows the server returns for the team's needs (the same rows that draw the
 * radar). Only a `value` row carries a level; `insufficient_data` and `area_unavailable` never become a number.
 */
export function automaticOverviewAreas(rows: readonly AutomaticSkillLevelRow[], plannedTreeIds: ReadonlySet<string>): OverviewArea[] {
  return rows.map((row) => {
    const hasPlan = plannedTreeIds.has(row.treeId);
    const target = row.targetLevel;
    switch (row.state) {
      case "value":
        return { treeId: row.treeId, name: row.areaName, level: row.level, levelState: "value", target, hasPlan };
      case "insufficient_data":
        return { treeId: row.treeId, name: row.areaName, level: null, levelState: "insufficient_data", target, hasPlan };
      case "area_unavailable":
        return { treeId: row.treeId, name: null, level: null, levelState: "unavailable", target, hasPlan };
    }
  });
}

/**
 * Priority view. A confirmed gap needs both a level and a target. An area with a target but no usable level is
 * "awaiting data", never a gap. An area without a target cannot be compared, so it is only counted.
 */
export interface PriorityGroups {
  readonly gaps: readonly OverviewArea[];
  readonly awaitingData: readonly OverviewArea[];
  readonly withoutTarget: number;
}

export function priorityGroups(areas: readonly OverviewArea[]): PriorityGroups {
  const gaps = areas
    .filter((area) => {
      const status = statusOf(area);
      return status === "near" || status === "under";
    })
    .sort((a, b) => gapOf(b) - gapOf(a));
  const awaitingData = areas.filter((area) => area.target !== null && area.levelState !== "value");
  const withoutTarget = areas.filter((area) => area.target === null).length;
  return { gaps, awaitingData, withoutTarget };
}

import type { RoadmapStatus } from "./roadmap-item";
import { compareRoadmapPlans, type RoadmapSortKey } from "./roadmap-sort";

export type RoadmapListItem = RoadmapSortKey;

export interface RoadmapListGroup<T extends RoadmapListItem> {
  status: RoadmapStatus;
  items: T[];
}

const GROUP_ORDER: readonly RoadmapStatus[] = ["active", "planned", "completed"];

/**
 * Default list grouping (SPEC BR-9a): non-archived plans grouped Pågår /
 * Planlagt / Fullført, each in `compareRoadmapPlans` order; empty groups are
 * omitted. Archived plans are not part of the default list. Pure; the input
 * (the canonical dataset) is never mutated.
 */
export function groupRoadmapList<T extends RoadmapListItem>(items: readonly T[]): RoadmapListGroup<T>[] {
  const visible = items.filter((item) => !item.archived);
  return GROUP_ORDER.map((status) => ({
    status,
    items: visible.filter((item) => item.status === status).sort(compareRoadmapPlans),
  })).filter((group) => group.items.length > 0);
}

/**
 * The final separate `Arkiverte` section (SPEC BR-9a/BR-17): only archived
 * plans, whatever their status, in `compareRoadmapPlans` order. Pure; the
 * input is never mutated.
 */
export function archivedRoadmapList<T extends RoadmapListItem>(items: readonly T[]): T[] {
  return items.filter((item) => item.archived).sort(compareRoadmapPlans);
}

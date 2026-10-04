import type { RoadmapPriority, RoadmapStatus } from "./roadmap-item";

/** The closed filter set (BR-14): no owner, area, tracking or text filter. */
export interface RoadmapFilter {
  status: "all" | RoadmapStatus;
  priority: "all" | RoadmapPriority;
  showArchived: boolean;
}

export const DEFAULT_ROADMAP_FILTER: RoadmapFilter = {
  status: "all",
  priority: "all",
  showArchived: false,
};

/** Plan fields the filter reads. The owner is deliberately absent. */
export interface RoadmapFilterPlan {
  status: RoadmapStatus;
  priority: RoadmapPriority;
  archived: boolean;
}

/** Plan fields the summary reads. */
export interface RoadmapSummaryPlan {
  status: RoadmapStatus;
  archived: boolean;
  overdue: boolean;
}

/** Plan fields the eligibility helper reads. */
export interface RoadmapTreePlan {
  treeId: string;
}

/**
 * Plan-count summary: mutually exclusive status counts over the non-archived
 * items (`total === active + planned + completed`). `overdue` is a subset of
 * `active + planned`, never a peer category.
 */
export interface RoadmapSummary {
  total: number;
  active: number;
  planned: number;
  completed: number;
  overdue: number;
}

/**
 * Applies status, priority and archived visibility in memory. Archived is not
 * a status: hidden archived plans never participate; shown ones are subject to
 * the same status/priority match. Returns a new array in the input's order.
 */
export function filterRoadmapItems<T extends RoadmapFilterPlan>(
  items: readonly T[],
  filter: RoadmapFilter,
): T[] {
  return items.filter(
    (item) =>
      (filter.showArchived || !item.archived) &&
      (filter.status === "all" || item.status === filter.status) &&
      (filter.priority === "all" || item.priority === filter.priority),
  );
}

/** Counts the unfiltered non-archived items; independent of any filter state. */
export function summarizeRoadmapItems(items: readonly RoadmapSummaryPlan[]): RoadmapSummary {
  const summary: RoadmapSummary = { total: 0, active: 0, planned: 0, completed: 0, overdue: 0 };
  for (const item of items) {
    if (item.archived) continue;
    summary.total += 1;
    summary[item.status] += 1;
    if (item.overdue && item.status !== "completed") summary.overdue += 1;
  }
  return summary;
}

/**
 * Tracked areas (exactly the team skills read) that have no plan: every
 * `treeId` in the complete archived-inclusive response — including archived
 * plans — is excluded. Keeps the input's order.
 */
export function eligibleRoadmapAreas<A extends RoadmapTreePlan>(
  trackedAreas: readonly A[],
  allItems: readonly RoadmapTreePlan[],
): A[] {
  const planned = new Set(allItems.map((item) => item.treeId));
  return trackedAreas.filter((area) => !planned.has(area.treeId));
}

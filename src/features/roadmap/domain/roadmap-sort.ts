import type { RoadmapPriority, RoadmapStatus } from "./roadmap-item";

const STATUS_RANK: Record<RoadmapStatus, number> = { active: 0, planned: 1, completed: 2 };
const PRIORITY_RANK: Record<RoadmapPriority, number> = { high: 0, medium: 1, low: 2 };

const collator = new Intl.Collator("nb", { sensitivity: "accent" });

/** Sort-relevant plan fields. The owner is deliberately never a sort key. */
export interface RoadmapSortKey {
  archived: boolean;
  status: RoadmapStatus;
  priority: RoadmapPriority;
  startDate?: string | null;
  targetDate?: string | null;
  /** `null` = the SkillTree cannot be resolved; sorts after every named area. */
  areaName: string | null;
  treeId: string;
}

/** `nb` collation; an unresolved (`null`) area name sorts after every named area. */
function compareAreaNames(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return collator.compare(a, b);
}

/** Ascending, with absent values last. */
function compareOptionalAscending(a: string | null | undefined, b: string | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Presentation order (SPEC — "Presentation sort"): non-archived first; status
 * active < planned < completed; priority high < medium < low; target date
 * ascending (absent last); start date ascending (absent last); area name
 * (`nb`; unresolved `null` last); `treeId`. Storage order is never relied on.
 */
export function compareRoadmapPlans(a: RoadmapSortKey, b: RoadmapSortKey): number {
  if (a.archived !== b.archived) return a.archived ? 1 : -1;
  return (
    STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    compareOptionalAscending(a.targetDate, b.targetDate) ||
    compareOptionalAscending(a.startDate, b.startDate) ||
    compareAreaNames(a.areaName, b.areaName) ||
    (a.treeId < b.treeId ? -1 : a.treeId > b.treeId ? 1 : 0)
  );
}

/**
 * Orders Kompetanseområde rows: areas with a non-archived plan first (in
 * `compareRoadmapPlans` order), then areas without one by `nb` name, then
 * `treeId`. Archived plans do not lift an area. Pure; returns a new array.
 */
export function orderAreasForPlanning<A extends { treeId: string; name: string }>(
  areas: readonly A[],
  plans: readonly Omit<RoadmapSortKey, "areaName">[],
): A[] {
  const planByTree = new Map<string, Omit<RoadmapSortKey, "areaName">>();
  for (const plan of plans) {
    if (!plan.archived) planByTree.set(plan.treeId, plan);
  }
  const planned = areas.filter((area) => planByTree.has(area.treeId));
  const unplanned = areas.filter((area) => !planByTree.has(area.treeId));

  planned.sort((x, y) =>
    compareRoadmapPlans(
      { ...(planByTree.get(x.treeId) as Omit<RoadmapSortKey, "areaName">), areaName: x.name },
      { ...(planByTree.get(y.treeId) as Omit<RoadmapSortKey, "areaName">), areaName: y.name },
    ),
  );
  unplanned.sort(
    (x, y) => collator.compare(x.name, y.name) || (x.treeId < y.treeId ? -1 : x.treeId > y.treeId ? 1 : 0),
  );
  return [...planned, ...unplanned];
}

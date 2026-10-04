import { isValidPlanDate } from "./roadmap-dates";
import { compareRoadmapPlans, type RoadmapSortKey } from "./roadmap-sort";

/** The plan fields the timeline reads. The owner is deliberately absent. */
export interface RoadmapTimelinePlan extends RoadmapSortKey {
  overdue: boolean;
  /** ISO completion time; `null` for a legacy completed plan. Never synthesised. */
  completedAt: string | null;
}

export interface RoadmapQuarter {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  /** Stable, lexicographically sortable identity, e.g. `2026-Q4`. */
  key: string;
  /** Display label, e.g. `4. kvartal 2026`. */
  label: string;
}

export type RoadmapTimelineGroup<T extends RoadmapTimelinePlan> =
  | { kind: "overdue"; items: T[] }
  | { kind: "quarter"; quarter: RoadmapQuarter; items: T[] }
  | { kind: "start-only"; items: T[] }
  | { kind: "undated"; items: T[] }
  | { kind: "completed"; items: T[] }
  | { kind: "archived"; items: T[] };

/**
 * Calendar quarter of a valid plan date, read from the string itself so no
 * timezone can move a date into another quarter. Validity is the canonical
 * plan-date rule (real calendar date, year 2020–2100).
 */
export function quarterOf(isoDate: string): RoadmapQuarter {
  if (!isValidPlanDate(isoDate)) {
    throw new Error("quarterOf requires a valid plan date (YYYY-MM-DD)");
  }
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const quarter = (Math.floor((month - 1) / 3) + 1) as RoadmapQuarter["quarter"];
  return { year, quarter, key: `${year}-Q${quarter}`, label: `${quarter}. kvartal ${year}` };
}

function compareOptionalAscending(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `completedAt` descending, absent (`null`) last. */
function compareCompletedAtDescending(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : a > b ? -1 : 0;
}

function sortedBy<T extends RoadmapTimelinePlan>(
  items: T[],
  primary: (a: T, b: T) => number,
): T[] {
  return items.sort((a, b) => primary(a, b) || compareRoadmapPlans(a, b));
}

/**
 * Partitions plans into timeline groups by first-match precedence (SPEC BR-9)
 * and orders groups and items per BR-10. Pure and deterministic: `overdue` is
 * the server-derived flag, nothing reads the clock, the input is not mutated,
 * and empty groups are omitted.
 */
export function groupRoadmapTimeline<T extends RoadmapTimelinePlan>(
  plans: readonly T[],
): RoadmapTimelineGroup<T>[] {
  const overdue: T[] = [];
  const quarters = new Map<string, { quarter: RoadmapQuarter; items: T[] }>();
  const startOnly: T[] = [];
  const undated: T[] = [];
  const completed: T[] = [];
  const archived: T[] = [];

  for (const plan of plans) {
    if (plan.archived) archived.push(plan);
    else if (plan.status === "completed") completed.push(plan);
    else if (plan.overdue) overdue.push(plan);
    else if (plan.targetDate) {
      const quarter = quarterOf(plan.targetDate);
      const bucket = quarters.get(quarter.key);
      if (bucket) bucket.items.push(plan);
      else quarters.set(quarter.key, { quarter, items: [plan] });
    } else if (plan.startDate) startOnly.push(plan);
    else undated.push(plan);
  }

  const byTarget = (a: T, b: T) => compareOptionalAscending(a.targetDate ?? null, b.targetDate ?? null);
  const groups: RoadmapTimelineGroup<T>[] = [];

  if (overdue.length) groups.push({ kind: "overdue", items: sortedBy(overdue, byTarget) });
  [...quarters.values()]
    .sort((a, b) => (a.quarter.key < b.quarter.key ? -1 : a.quarter.key > b.quarter.key ? 1 : 0))
    .forEach(({ quarter, items }) =>
      groups.push({ kind: "quarter", quarter, items: sortedBy(items, byTarget) }),
    );
  if (startOnly.length) {
    groups.push({
      kind: "start-only",
      items: sortedBy(startOnly, (a, b) => compareOptionalAscending(a.startDate ?? null, b.startDate ?? null)),
    });
  }
  if (undated.length) groups.push({ kind: "undated", items: sortedBy(undated, () => 0) });
  if (completed.length) {
    groups.push({
      kind: "completed",
      items: sortedBy(completed, (a, b) => compareCompletedAtDescending(a.completedAt, b.completedAt)),
    });
  }
  if (archived.length) groups.push({ kind: "archived", items: sortedBy(archived, () => 0) });
  return groups;
}

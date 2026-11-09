import type { MilestoneStatus, PlanMilestone } from "./competence-plan";
import { isValidPlanDate } from "../../roadmap/domain/roadmap-dates";

/**
 * Timeline model for the Kompetanseplan overview (TASK-006, reference 20). Pure: the window is passed in, never read
 * from the clock. Bars span a plan's dated milestones and are clipped to the window; undated milestones are not drawn.
 */

export type TimelineSpan = 3 | 6;

/** A calendar month. `month` is 1–12. */
export interface MonthRef {
  year: number;
  month: number;
}

export interface TimelineMarker {
  id: string;
  /** Position in percent of the window width. */
  pct: number;
  status: MilestoneStatus;
}

export interface TimelineRow {
  treeId: string;
  /** Bar start and width in percent of the window; `null` when the plan has no dated milestone inside the window. */
  bar: { startPct: number; widthPct: number } | null;
  markers: TimelineMarker[];
}

export interface PlanTimeline {
  months: MonthRef[];
  rows: TimelineRow[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function monthStartDay(ref: MonthRef): number {
  return Date.UTC(ref.year, ref.month - 1, 1) / DAY_MS;
}

/** Month `offset` months after `start`, normalising year rollover. */
export function addMonths(start: MonthRef, offset: number): MonthRef {
  const index = start.year * 12 + (start.month - 1) + offset;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Builds the month columns and one row per plan. A plan without dated milestones still gets a row (no bar). */
export function buildPlanTimeline(
  plans: ReadonlyArray<{ treeId: string; milestones: readonly PlanMilestone[] }>,
  start: MonthRef,
  span: TimelineSpan,
): PlanTimeline {
  const months = Array.from({ length: span }, (_, index) => addMonths(start, index));
  const windowStart = monthStartDay(start);
  const windowEnd = monthStartDay(addMonths(start, span));
  const length = windowEnd - windowStart;
  const pctOf = (day: number) => ((day - windowStart) / length) * 100;

  const rows = plans.map((plan): TimelineRow => {
    const dated = plan.milestones.flatMap((milestone) => {
      if (milestone.targetDate === null || !isValidPlanDate(milestone.targetDate)) return [];
      return [{ milestone, day: utcDay(milestone.targetDate) }];
    });
    const inWindow = dated.filter(({ day }) => day >= windowStart && day < windowEnd);
    const markers = inWindow.map(({ milestone, day }) => ({ id: milestone.id, pct: pctOf(day), status: milestone.status }));

    const first = dated.length === 0 ? null : Math.min(...dated.map(({ day }) => day));
    const last = dated.length === 0 ? null : Math.max(...dated.map(({ day }) => day));
    const overlaps = first !== null && last !== null && last >= windowStart && first < windowEnd;
    if (!overlaps || first === null || last === null) return { treeId: plan.treeId, bar: null, markers };

    const clippedStart = Math.max(first, windowStart);
    const clippedEnd = Math.min(last, windowEnd - 1);
    return {
      treeId: plan.treeId,
      bar: { startPct: pctOf(clippedStart), widthPct: Math.max(pctOf(clippedEnd) - pctOf(clippedStart), 1) },
      markers,
    };
  });

  return { months, rows };
}

export interface NextStep {
  treeId: string;
  milestone: PlanMilestone;
}

/**
 * Upcoming steps across all plans: not completed, earliest dated first, undated last. Only plan steps are listed; no
 * member data is involved.
 */
export function nextPlanSteps(
  plans: ReadonlyArray<{ treeId: string; archived: boolean; milestones: readonly PlanMilestone[] }>,
  limit: number,
): NextStep[] {
  const open = plans
    .filter((plan) => !plan.archived)
    .flatMap((plan) => plan.milestones.filter((m) => m.status !== "completed").map((milestone) => ({ treeId: plan.treeId, milestone })));
  const key = (step: NextStep) => (step.milestone.targetDate !== null && isValidPlanDate(step.milestone.targetDate) ? step.milestone.targetDate : "￿");
  return open.sort((a, b) => key(a).localeCompare(key(b))).slice(0, limit);
}

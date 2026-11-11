import type { PlanMilestone } from "./competence-plan";
import { isValidPlanDate } from "../../roadmap/domain/roadmap-dates";

/**
 * Presentation-only helpers for the Kompetanseplan cards (TASK-006, reference 20). Pure: no clock, no I/O. Progress
 * is plan-step completion only; the card status never reflects a member's skill level.
 */

export type PlanCardStatus = "not_started" | "in_progress" | "completed" | "no_steps";

/** Derived card status. A plan without steps is `no_steps`; otherwise it follows the completed/in-progress counts. */
export function planCardStatus(milestones: readonly PlanMilestone[]): PlanCardStatus {
  if (milestones.length === 0) return "no_steps";
  const completed = milestones.filter((milestone) => milestone.status === "completed").length;
  if (completed === milestones.length) return "completed";
  const started = milestones.some((milestone) => milestone.status !== "planned");
  return started ? "in_progress" : "not_started";
}

const NB_DATE = new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Norwegian label for a stored `YYYY-MM-DD` milestone date, e.g. "15. jan. 2027". Formatted in UTC so the calendar day
 * never shifts with the viewer's timezone. Returns `null` for anything that is not a valid plan date.
 */
export function formatPlanDate(isoDate: string | null): string | null {
  if (isoDate === null || !isValidPlanDate(isoDate)) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  return NB_DATE.format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * A step is overdue when it is not completed and its target date is before `today` (an ISO `YYYY-MM-DD` day, passed in
 * so the rule stays pure). An undated step is never overdue.
 */
export function isMilestoneOverdue(milestone: Pick<PlanMilestone, "status" | "targetDate">, today: string): boolean {
  if (milestone.status === "completed") return false;
  if (milestone.targetDate === null || !isValidPlanDate(milestone.targetDate)) return false;
  return milestone.targetDate < today;
}

export interface PlanSummaryMetrics {
  activePlans: number;
  completedSteps: number;
  remainingSteps: number;
  totalSteps: number;
  /** Completed steps as a whole percent of all steps across active plans; `null` when there are no steps to measure. */
  percent: number | null;
}

/** Totals across the active (non-archived) plans. Derived on every render from the saved plans; nothing is stored. */
export function planSummaryMetrics(plans: ReadonlyArray<{ archived: boolean; milestones: readonly PlanMilestone[] }>): PlanSummaryMetrics {
  const active = plans.filter((plan) => !plan.archived);
  const steps = active.flatMap((plan) => plan.milestones);
  const completedSteps = steps.filter((step) => step.status === "completed").length;
  const totalSteps = steps.length;
  return {
    activePlans: active.length,
    completedSteps,
    remainingSteps: totalSteps - completedSteps,
    totalSteps,
    percent: totalSteps === 0 ? null : Math.round((completedSteps / totalSteps) * 100),
  };
}

/**
 * Pure summary rules for the team Oversikt (docs/archive/features/team-experience-redesign TASK-008, SPEC BR-1–BR-4).
 * Each count is derived from an already-authorized detail read, so it agrees with the detail tab under the same
 * scope and archive filters (BR-2). Nothing here is persisted, ranked, or attributed to a named person.
 */
import type { ProjectEffectiveStatus } from "../../team-projects/domain/team-project";
import type { RoadmapPriority } from "../../roadmap/domain/roadmap-item";

export interface OversiktProjectInput {
  archived: boolean;
  effectiveStatus: ProjectEffectiveStatus;
}

export interface OversiktPlanInput {
  archived: boolean;
  priority: RoadmapPriority;
}

/** Non-archived projects whose effective status is `active` (`Pågår`). Matches the Roadmap tab's active filter. */
export function countActiveProjects(projects: readonly OversiktProjectInput[]): number {
  return projects.filter((project) => !project.archived && project.effectiveStatus === "active").length;
}

/** Non-archived competence plans with high priority. Plan progress is never used here (TASK-006). */
export function countPriorityPlans(plans: readonly OversiktPlanInput[]): number {
  return plans.filter((plan) => !plan.archived && plan.priority === "high").length;
}

export type OversiktNextStepKind = "systems" | "competence-plan" | "roadmap";

export interface OversiktNextStep {
  kind: OversiktNextStepKind;
  count: number;
}

export const OVERSIKT_NEXT_STEPS_LIMIT = 3;

/**
 * Up to three next steps, in a fixed order of importance, each pointing to the detail tab that holds the work.
 * Steps with a zero count are omitted, so the list never shows an empty instruction.
 */
export function buildOversiktNextSteps(input: {
  systemsNeedingAttention: number | null;
  priorityPlans: number | null;
  activeProjects: number | null;
}): OversiktNextStep[] {
  const steps: OversiktNextStep[] = [];
  if (input.systemsNeedingAttention !== null && input.systemsNeedingAttention > 0) {
    steps.push({ kind: "systems", count: input.systemsNeedingAttention });
  }
  if (input.priorityPlans !== null && input.priorityPlans > 0) {
    steps.push({ kind: "competence-plan", count: input.priorityPlans });
  }
  if (input.activeProjects !== null && input.activeProjects > 0) {
    steps.push({ kind: "roadmap", count: input.activeProjects });
  }
  return steps.slice(0, OVERSIKT_NEXT_STEPS_LIMIT);
}

/** A list read's total and whether the server cut the list short. */
export interface HeaderCountRead {
  count: number;
  truncated: boolean;
}

/**
 * The header count to show for a list read, or `null` when no honest total exists. A truncated list would understate the
 * team total, so it is omitted rather than shown as a number. A failed or absent read is also `null`.
 */
export function completeHeaderCount(read: HeaderCountRead | null): number | null {
  if (read === null || read.truncated) {
    return null;
  }
  return read.count;
}

import type { StageNode } from "./roadmap-form";

/** Plan fields the per-item mutation rules read. */
export interface MutablePlanFacts {
  treeId: string;
  areaName: string | null;
  status: "planned" | "active" | "completed";
  completedAt: string | null;
  tracking: { state: "tracked" | "not_tracked" };
}

/** A tracked competency area as the team skills read returns it. */
export interface TrackedAreaFacts {
  treeId: string;
  name: string;
  currentNodeId: string | null;
  nodes: StageNode[];
}

export interface PlanEditingContext {
  area: TrackedAreaFacts;
  /** Untracked plan (D13): the target is locked and never part of a write. */
  targetLocked: boolean;
}

/**
 * Legacy completed plan (SPEC BR-23a): completed without a `completedAt`. It is
 * readable but read-only in Feature B v1 — the strict mutation parser would
 * reject it, so no control may exist and no PATCH may be sent. This is a
 * per-item rule, separate from the page-level `canEdit`/`canMutate`.
 */
export function isLegacyReadOnlyPlan(plan: Pick<MutablePlanFacts, "status" | "completedAt">): boolean {
  return plan.status === "completed" && plan.completedAt === null;
}

/**
 * The single per-item mutation decision (callers apply page-level `canMutate`
 * first). Returns the editor inputs, or `null` when the plan must be read-only:
 * legacy completed plans, and tracked plans whose area is missing from the
 * skills read (no stage data is ever inferred from the roadmap DTO).
 */
export function planEditingContext(
  plan: MutablePlanFacts,
  trackedAreas: readonly TrackedAreaFacts[],
  unnamedArea: string,
): PlanEditingContext | null {
  if (isLegacyReadOnlyPlan(plan)) return null;
  if (plan.tracking.state === "not_tracked") {
    return {
      area: { treeId: plan.treeId, name: plan.areaName ?? unnamedArea, currentNodeId: null, nodes: [] },
      targetLocked: true,
    };
  }
  const area = trackedAreas.find((candidate) => candidate.treeId === plan.treeId);
  return area ? { area, targetLocked: false } : null;
}

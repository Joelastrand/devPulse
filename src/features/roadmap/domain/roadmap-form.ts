import type { RoadmapPriority, RoadmapStatus } from "./roadmap-item";

/** Sentinel option value: keep an existing owner the client cannot resolve (never sent). */
export const KEEP_OWNER = "__keep_owner__";

export interface StageNode {
  nodeId: string;
  label: string;
  order: number;
}

export interface TargetOption {
  nodeId: string;
  label: string;
}

/**
 * Stages that may be chosen as target for an area: strictly above the current
 * stage (`null` current = below the first node, so every node qualifies). A
 * current stage that is not a node of the tree cannot be compared, so nothing
 * is offered (the server stays authoritative either way). Ordering is by
 * `order`, labels come from the tree — never from the node id.
 */
export function forwardTargetOptions(nodes: readonly StageNode[], currentNodeId: string | null): TargetOption[] {
  const sorted = nodes.slice().sort((a, b) => a.order - b.order);
  let floor = -Infinity;
  if (currentNodeId !== null) {
    const current = sorted.find((node) => node.nodeId === currentNodeId);
    if (!current) return [];
    floor = current.order;
  }
  return sorted.filter((node) => node.order > floor).map(({ nodeId, label }) => ({ nodeId, label }));
}

export interface PlanFormValues {
  targetNodeId: string;
  priority: RoadmapPriority;
  status: RoadmapStatus;
  startDate: string;
  targetDate: string;
  /** A `memberRef`, `""` (no owner) or `KEEP_OWNER`. */
  owner: string;
}

export interface ExistingPlanValues {
  targetNodeId: string;
  priority: RoadmapPriority;
  status: RoadmapStatus;
  startDate: string | null;
  targetDate: string | null;
  /** `null` = no owner, `"unavailable"` = persisted owner the client cannot resolve. */
  owner: { memberRef: string } | null | "unavailable";
}

export function initialOwnerValue(owner: ExistingPlanValues["owner"]): string {
  if (owner === "unavailable") return KEEP_OWNER;
  return owner === null ? "" : owner.memberRef;
}

/** `startDate <= targetDate` on plain `YYYY-MM-DD` strings; an empty side never conflicts. */
export function datesInOrder(startDate: string, targetDate: string): boolean {
  return startDate === "" || targetDate === "" || startDate <= targetDate;
}

/** Create body: only the approved fields; empty optional fields are omitted. */
export function buildCreateBody(treeId: string, values: PlanFormValues): Record<string, unknown> {
  const body: Record<string, unknown> = {
    treeId,
    targetNodeId: values.targetNodeId,
    priority: values.priority,
  };
  if (values.startDate !== "") body.startDate = values.startDate;
  if (values.targetDate !== "") body.targetDate = values.targetDate;
  if (values.owner !== "" && values.owner !== KEEP_OWNER) body.ownerRef = values.owner;
  return body;
}

/**
 * Minimal PATCH body: only changed fields. Unchanged owner (including an
 * unresolvable one left untouched) and unchanged target are omitted; a cleared
 * date or owner is `null`. Returns `null` when nothing changed (no request).
 */
export function buildPatchBody(existing: ExistingPlanValues, values: PlanFormValues): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};
  if (values.targetNodeId !== "" && values.targetNodeId !== existing.targetNodeId) {
    body.targetNodeId = values.targetNodeId;
  }
  if (values.priority !== existing.priority) body.priority = values.priority;
  if (values.status !== existing.status) body.status = values.status;
  if (values.startDate !== (existing.startDate ?? "")) body.startDate = values.startDate === "" ? null : values.startDate;
  if (values.targetDate !== (existing.targetDate ?? "")) body.targetDate = values.targetDate === "" ? null : values.targetDate;
  if (values.owner !== KEEP_OWNER && values.owner !== initialOwnerValue(existing.owner)) {
    body.ownerRef = values.owner === "" ? null : values.owner;
  }
  return Object.keys(body).length === 0 ? null : body;
}

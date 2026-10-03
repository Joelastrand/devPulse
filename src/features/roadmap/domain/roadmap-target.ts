import type { SkillTreeRecord } from "../../skill-trees/domain/skill-tree";

export type TargetValidationError = "invalid_input" | "target_not_ahead" | "not_tracked";

export type TargetValidation =
  | { ok: true }
  | { ok: false; error: TargetValidationError };

/** Order of `nodeId` within the tree by actual membership — never by id shape. */
function nodeOrder(tree: Pick<SkillTreeRecord, "nodes">, nodeId: unknown): number | null {
  if (typeof nodeId !== "string") {
    return null;
  }
  const node = tree.nodes.find((candidate) => candidate.nodeId === nodeId);
  return node ? node.order : null;
}

/**
 * Target-integrity rules 3–4 (SPEC — "Target-stage integrity") for a team that
 * is already known to track the tree (rule 1) with a valid tree (rule 2):
 * - the target must be a `nodeId` of THIS tree (membership test) else
 *   `invalid_input` — covers cross-tree, stale and malformed values;
 * - a non-null current stage must also be a node of this tree, else
 *   `not_tracked` (fail closed);
 * - the target's order must be strictly greater than the current's
 *   (`null` current = below the first node) else `target_not_ahead`.
 */
export function validateTargetNode(
  tree: Pick<SkillTreeRecord, "nodes">,
  currentNodeId: string | null,
  targetNodeId: unknown,
): TargetValidation {
  const targetOrder = nodeOrder(tree, targetNodeId);
  if (targetOrder === null) {
    return { ok: false, error: "invalid_input" };
  }

  if (currentNodeId === null) {
    return { ok: true };
  }
  const currentOrder = nodeOrder(tree, currentNodeId);
  if (currentOrder === null) {
    return { ok: false, error: "not_tracked" };
  }

  return targetOrder > currentOrder ? { ok: true } : { ok: false, error: "target_not_ahead" };
}

/**
 * Derived, never stored: current stage has reached or passed the target.
 * `null` current means "tracked, not started" (below every node). Returns
 * `null` ("cannot be derived") when the target or a non-null current stage is
 * not a node of the tree. Callers omit the indicator entirely for an untracked
 * area. Reaching the target never changes the plan's status.
 */
export function isTargetReached(
  tree: Pick<SkillTreeRecord, "nodes">,
  currentNodeId: string | null,
  targetNodeId: string,
): boolean | null {
  const targetOrder = nodeOrder(tree, targetNodeId);
  if (targetOrder === null) {
    return null;
  }
  if (currentNodeId === null) {
    return false;
  }
  const currentOrder = nodeOrder(tree, currentNodeId);
  return currentOrder === null ? null : currentOrder >= targetOrder;
}

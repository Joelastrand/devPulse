import "server-only";
import { isAddressableGoalId } from "../domain/goal-constants";
import { getDefaultGoalStore } from "./goal-store";
import type { GoalStore } from "./goal-store-types";

export type DeletePersonalGoalResult = { ok: true } | { ok: false; error: "persistence_failed" };

/**
 * Owner-only hard delete (BR-19, BR-26). A shape-invalid id is treated as missing without any store access
 * (BR-27a). Otherwise exactly one owner-scoped delete: the document is never read or parsed, so malformed and
 * missing-`createdAt` documents are deletable, and missing/foreign ids are indistinguishable and idempotent.
 */
export async function deletePersonalGoal(
  ownerUid: string,
  goalId: string,
  deps: { store: GoalStore } = { store: getDefaultGoalStore() },
): Promise<DeletePersonalGoalResult> {
  if (!isAddressableGoalId(goalId)) return { ok: true };
  try {
    await deps.store.delete(ownerUid, goalId);
    return { ok: true };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

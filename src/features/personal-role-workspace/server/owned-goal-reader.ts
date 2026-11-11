import "server-only";
import { getDefaultGoalStore } from "../../personal-goals/server/goal-store";
import { isAddressableGoalId } from "../../personal-goals/domain/goal-constants";

/**
 * The one place this feature reads the D1 goal store: an existence check of a goal the owner already has (SPEC BR-60,
 * BR-61). It returns no goal content and no title, and it takes the owner uid only from the operation, never from a request.
 * It is listed in the D1 scope guard's approved importers and is the only importer of the goal store from this feature.
 */
export async function ownedGoalExists(ownerUid: string, goalId: string): Promise<boolean> {
  if (!isAddressableGoalId(goalId)) return false;
  const stored = await getDefaultGoalStore().get(ownerUid, goalId);
  return stored !== undefined;
}

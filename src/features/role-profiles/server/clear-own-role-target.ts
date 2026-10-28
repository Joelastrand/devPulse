import { getDefaultRoleTargetStore } from "./role-target-store";
import type { RoleTargetStore } from "./role-target-store-types";

export interface ClearRoleTargetDeps {
  targets?: RoleTargetStore;
}

/**
 * Owner-only hard delete of the caller's target role (BR-10, PO-1). Deleting an absent target succeeds. No tombstone
 * and no history are written. `subjectUid` must be the verified token uid. A failed delete rejects.
 */
export async function clearOwnRoleTarget(subjectUid: string, deps: ClearRoleTargetDeps = {}): Promise<void> {
  const targets = deps.targets ?? getDefaultRoleTargetStore();
  await targets.delete(subjectUid);
}

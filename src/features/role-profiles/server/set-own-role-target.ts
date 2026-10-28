import { getDefaultRoleTargetStore } from "./role-target-store";
import type { RoleTargetStore } from "./role-target-store-types";
import { readReferencedRole } from "./read-referenced-role";
import { resolveSkillTreeReferences } from "./skill-tree-seam-types";

export interface SetRoleTargetDeps {
  targets?: RoleTargetStore;
  now?: () => Date;
}

export type SetOwnRoleTargetResult = { ok: true } | { ok: false; error: "not_found" | "role_not_selectable" };

const NOT_FOUND: SetOwnRoleTargetResult = { ok: false, error: "not_found" };
const NOT_SELECTABLE: SetOwnRoleTargetResult = { ok: false, error: "role_not_selectable" };

/**
 * Owner-only selection of the caller's target role (BR-3, BR-8, BR-10, PG-2, PG-7, PG-9). `subjectUid` must be the
 * verified token uid. A missing or malformed role is `not_found`. An archived role, a zero-expectation role, or one with
 * no valid SkillTree is `role_not_selectable`. Refusals write nothing. The eligibility reads and the single write run in
 * one transaction, so an archive committed before the read is seen. Replacing any existing or malformed target is
 * allowed; last write wins and no history is kept.
 */
export async function setOwnRoleTarget(
  subjectUid: string,
  roleId: string,
  deps: SetRoleTargetDeps = {},
): Promise<SetOwnRoleTargetResult> {
  const targets = deps.targets ?? getDefaultRoleTargetStore();
  const now = deps.now ?? (() => new Date());

  return targets.runSelection(subjectUid, async (scope) => {
    const role = await readReferencedRole((id) => scope.readRole(id), roleId);
    if (role === undefined) return NOT_FOUND;
    if (role.archivedAt !== undefined || role.expectations.length === 0) return NOT_SELECTABLE;

    const references = await resolveSkillTreeReferences(
      role.expectations.map((expectation) => expectation.treeId),
      scope.trees,
    );
    const selectable = role.expectations.some((expectation) => references.get(expectation.treeId)?.status === "valid");
    if (!selectable) return NOT_SELECTABLE;

    scope.writeTarget({ roleId, updatedAt: now() });
    return { ok: true };
  });
}

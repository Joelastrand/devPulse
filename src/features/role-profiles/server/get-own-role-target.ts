import type { RoleDefinition } from "../domain/role-definition";
import { parseStoredRoleTarget, type RoleTargetStatus } from "../domain/role-target";
import { getDefaultRoleStore } from "./role-store";
import type { RoleStore } from "./role-store-types";
import { readReferencedRole } from "./read-referenced-role";
import { getDefaultRoleTargetStore } from "./role-target-store";
import type { RoleTargetStore } from "./role-target-store-types";

export interface RoleTargetDeps {
  targets?: RoleTargetStore;
  roles?: RoleStore;
}

/** The owner's target with its referenced role, for server-side use. Not a DTO: callers must not return it as-is. */
export type OwnTargetRole =
  | { status: "none" }
  | { status: "unavailable" }
  | { status: "selected"; roleId: string; role: RoleDefinition };

/**
 * Reads the owner's target and its referenced role (BR-19, BR-20). `subjectUid` must be the verified token uid.
 * A missing, malformed or unaddressable target or role is `none` or `unavailable`. The read performs no write.
 */
export async function readOwnTargetRole(subjectUid: string, deps: RoleTargetDeps = {}): Promise<OwnTargetRole> {
  const targets = deps.targets ?? getDefaultRoleTargetStore();
  const roles = deps.roles ?? getDefaultRoleStore();

  const raw = await targets.get(subjectUid);
  if (raw === undefined) return { status: "none" };

  const stored = parseStoredRoleTarget(raw);
  if (!stored.ok) return { status: "unavailable" };

  const role = await readReferencedRole((roleId) => roles.get(roleId), stored.target.roleId);
  if (role === undefined) return { status: "unavailable" };

  return { status: "selected", roleId: stored.target.roleId, role };
}

/**
 * Owner-only read of the caller's target role for the person's section (BR-10, BR-19, BR-20, PG-3). The result carries
 * no stored content when it is not `selected`.
 */
export async function getOwnRoleTarget(subjectUid: string, deps: RoleTargetDeps = {}): Promise<RoleTargetStatus> {
  const read = await readOwnTargetRole(subjectUid, deps);
  if (read.status === "selected") {
    return {
      status: "selected",
      target: { roleId: read.roleId, name: read.role.name, archived: read.role.archivedAt !== undefined },
    };
  }
  return { status: read.status };
}

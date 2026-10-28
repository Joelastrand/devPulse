import {
  parseStoredRoleDefinition,
  validateRolePatch,
  type RoleAdminDto,
  type RoleDefinition,
  type RoleDescriptionChange,
} from "../domain/role-definition";
import { requireAppAdmin, type RequireAppAdminDeps } from "../../teams/server/require-app-admin";
import { toAdminRoleDto } from "./role-admin-mapping";
import { getDefaultRoleStore } from "./role-store";
import { isAddressableRoleId, type RoleFieldChanges, type RoleStore } from "./role-store-types";
import { getDefaultSkillTreeReader } from "./skill-tree-seam";
import { resolveSkillTreeReferences, type RawSkillTreeReader } from "./skill-tree-seam-types";

export interface UpdateRoleDeps extends RequireAppAdminDeps {
  store?: RoleStore;
  treeReader?: RawSkillTreeReader;
  now?: () => Date;
}

function nextDescription(current: string | undefined, change: RoleDescriptionChange | undefined): string | undefined {
  if (change === undefined) return current;
  return "set" in change ? change.set : undefined;
}

export type UpdateRoleResult =
  | { ok: true; role: RoleAdminDto }
  | {
      ok: false;
      error:
        | "unauthenticated"
        | "forbidden"
        | "invalid_input"
        | "not_found"
        | "role_archived"
        | "skill_not_found"
        | "persistence_failed";
    };

/**
 * Admin partial edit of a role (BR-1, BR-2, PG-6, PG-9, PG-10). Authorization runs first. A missing or malformed
 * role is `not_found` and is never repaired. An archived role is refused with `role_archived` and nothing is
 * written. Expectations, when present, replace the whole array and every `treeId` must resolve to a valid
 * SkillTree. `createdAt` is never changed. Last write wins (no transaction).
 */
export async function updateRole(
  idToken: string,
  roleId: string,
  input: unknown,
  deps: UpdateRoleDeps = {},
): Promise<UpdateRoleResult> {
  const admin = await requireAppAdmin(idToken, { verifyToken: deps.verifyToken, allowList: deps.allowList });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const validated = validateRolePatch(input);
  if (!validated.ok) {
    return { ok: false, error: "invalid_input" };
  }
  const { patch } = validated;
  // PG-9: a roleId that cannot address a document is the same `not_found` as a missing role, never a persistence failure.
  if (!isAddressableRoleId(roleId)) return { ok: false, error: "not_found" };

  try {
    const store = deps.store ?? getDefaultRoleStore();
    const raw = await store.get(roleId);
    const parsed = raw === undefined ? undefined : parseStoredRoleDefinition(raw);
    if (!parsed?.ok) {
      return { ok: false, error: "not_found" };
    }
    const current = parsed.role;
    if (current.archivedAt !== undefined) {
      return { ok: false, error: "role_archived" };
    }

    const expectations = patch.expectations ?? current.expectations;
    const references = await resolveSkillTreeReferences(
      expectations.map((expectation) => expectation.treeId),
      deps.treeReader ?? getDefaultSkillTreeReader(),
    );
    if (!expectations.every((expectation) => references.get(expectation.treeId)?.status === "valid")) {
      return { ok: false, error: "skill_not_found" };
    }

    const updatedAt = (deps.now ?? (() => new Date()))();
    const changes: RoleFieldChanges = { set: { updatedAt, updatedBy: admin.identity.uid }, unset: [] };
    if (patch.name !== undefined) changes.set.name = patch.name;
    if (patch.expectations !== undefined) changes.set.expectations = patch.expectations;
    if (patch.description !== undefined) {
      if ("set" in patch.description) {
        changes.set.description = patch.description.set;
      } else {
        changes.unset.push("description");
      }
    }
    await store.update(roleId, changes);

    const next: RoleDefinition = {
      name: patch.name ?? current.name,
      expectations,
      createdAt: current.createdAt,
      updatedAt,
    };
    const description = nextDescription(current.description, patch.description);
    if (description !== undefined) {
      next.description = description;
    }
    return { ok: true, role: toAdminRoleDto(roleId, next, references) };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

import {
  parseStoredRoleDefinition,
  validateRolePatch,
  type RoleAdminDto,
  type RoleDefinition,
} from "../domain/role-definition";
import { requireAppAdmin, type RequireAppAdminDeps } from "../../teams/server/require-app-admin";
import { toAdminRoleDto } from "./role-admin-mapping";
import { getDefaultRoleWriteStore } from "./role-store";
import { writeRefusalFor } from "../../auth/server/erasure-write-fence";
import { isAddressableRoleId, type RoleFieldChanges, type RoleStore } from "./role-store-types";
import { type AuthRefusal } from "../../auth/server/auth-refusal";

export interface UpdateRoleDeps extends RequireAppAdminDeps {
  store?: RoleStore;
  now?: () => Date;
}

export type UpdateRoleResult =
  | { ok: true; role: RoleAdminDto }
  | {
      ok: false;
      error: AuthRefusal | "forbidden" | "invalid_input" | "not_found" | "role_archived" | "persistence_failed";
    };

/**
 * Admin partial edit of a title and/or description. Authorization runs first. A missing or malformed role is
 * `not_found` and is never repaired. An archived role is refused with `role_archived` and nothing is written.
 * `createdAt` is never changed. Last write wins (no transaction).
 */
export async function updateRole(
  idToken: string,
  roleId: string,
  input: unknown,
  deps: UpdateRoleDeps = {},
): Promise<UpdateRoleResult> {
  const admin = await requireAppAdmin(idToken, { verifyToken: deps.verifyToken, isSuperadmin: deps.isSuperadmin });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const validated = validateRolePatch(input);
  if (!validated.ok) {
    return { ok: false, error: "invalid_input" };
  }
  const { patch } = validated;
  // A roleId that cannot address a document is the same `not_found` as a missing role, never a persistence failure.
  if (!isAddressableRoleId(roleId)) return { ok: false, error: "not_found" };

  try {
    const store = deps.store ?? getDefaultRoleWriteStore(admin.identity.uid);
    const raw = await store.get(roleId);
    const parsed = raw === undefined ? undefined : parseStoredRoleDefinition(raw);
    if (!parsed?.ok) {
      return { ok: false, error: "not_found" };
    }
    const current = parsed.role;
    if (current.archivedAt !== undefined) {
      return { ok: false, error: "role_archived" };
    }

    const updatedAt = (deps.now ?? (() => new Date()))();
    const changes: RoleFieldChanges = { set: { updatedAt, updatedBy: admin.identity.uid }, unset: [] };
    if (patch.name !== undefined) changes.set.name = patch.name;
    if (patch.description !== undefined) changes.set.description = patch.description;
    await store.update(roleId, changes);

    const next: RoleDefinition = {
      name: patch.name ?? current.name,
      description: patch.description ?? current.description,
      createdAt: current.createdAt,
      updatedAt,
    };
    return { ok: true, role: toAdminRoleDto(roleId, next) };
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }
}

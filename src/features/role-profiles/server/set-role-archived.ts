import { parseStoredRoleDefinition, type RoleAdminDto, type RoleDefinition } from "../domain/role-definition";
import { requireAppAdmin, type RequireAppAdminDeps } from "../../teams/server/require-app-admin";
import { toAdminRoleDto } from "./role-admin-mapping";
import { getDefaultRoleWriteStore } from "./role-store";
import { writeRefusalFor } from "../../auth/server/erasure-write-fence";
import { isAddressableRoleId, type RoleStore } from "./role-store-types";
import { type AuthRefusal } from "../../auth/server/auth-refusal";

export interface SetRoleArchivedDeps extends RequireAppAdminDeps {
  store?: RoleStore;
  now?: () => Date;
}

export type SetRoleArchivedResult =
  | { ok: true; role: RoleAdminDto }
  | { ok: false; error: AuthRefusal | "forbidden" | "invalid_input" | "not_found" | "persistence_failed" };

/**
 * Admin archive or restore. Archive sets `archivedAt` and `archivedBy`; restore removes both. Both are idempotent
 * `200` no-ops when the role is already in the requested state, and a no-op writes nothing. A missing or malformed
 * role is `not_found`. `createdAt` is never changed.
 */
export async function setRoleArchived(
  idToken: string,
  roleId: string,
  archived: unknown,
  deps: SetRoleArchivedDeps = {},
): Promise<SetRoleArchivedResult> {
  const admin = await requireAppAdmin(idToken, { verifyToken: deps.verifyToken, isSuperadmin: deps.isSuperadmin });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }
  if (typeof archived !== "boolean") {
    return { ok: false, error: "invalid_input" };
  }
  if (!isAddressableRoleId(roleId)) return { ok: false, error: "not_found" };

  try {
    const store = deps.store ?? getDefaultRoleWriteStore(admin.identity.uid);
    const raw = await store.get(roleId);
    const parsed = raw === undefined ? undefined : parseStoredRoleDefinition(raw);
    if (!parsed?.ok) {
      return { ok: false, error: "not_found" };
    }
    const current = parsed.role;
    const isArchived = current.archivedAt !== undefined;
    const now = (deps.now ?? (() => new Date()))();

    if (archived && !isArchived) {
      await store.update(roleId, { set: { archivedAt: now, archivedBy: admin.identity.uid }, unset: [] });
    } else if (!archived && isArchived) {
      await store.update(roleId, { set: {}, unset: ["archivedAt", "archivedBy"] });
    }

    const next: RoleDefinition = { ...current, archivedAt: archived ? (current.archivedAt ?? now) : undefined };
    return { ok: true, role: toAdminRoleDto(roleId, next) };
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }
}

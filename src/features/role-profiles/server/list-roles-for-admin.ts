import { parseStoredRoleDefinition, ROLE_LIST_WINDOW, type RoleAdminDto } from "../domain/role-definition";
import { requireAppAdmin, type RequireAppAdminDeps } from "../../teams/server/require-app-admin";
import { toAdminRoleDto } from "./role-admin-mapping";
import { getDefaultRoleStore } from "./role-store";
import type { RoleStore } from "./role-store-types";
import { type AuthRefusal } from "../../auth/server/auth-refusal";

export interface ListRolesForAdminDeps extends RequireAppAdminDeps {
  store?: RoleStore;
}

export interface ListRolesForAdminInput {
  includeArchived?: unknown;
}

export type ListRolesForAdminResult =
  | { ok: true; roles: RoleAdminDto[]; truncated: boolean }
  | { ok: false; error: AuthRefusal | "forbidden" | "invalid_input" | "persistence_failed" };

/**
 * Admin role list. Reads the 50-document window with `orderBy createdAt` and a 51-document probe. A stored document
 * that fails validation is skipped silently and never exposed, but it still consumes a window slot. `truncated` is set
 * when a 51st raw document exists. `includeArchived` defaults to true and accepts only a boolean.
 */
export async function listRolesForAdmin(
  idToken: string,
  input: ListRolesForAdminInput = {},
  deps: ListRolesForAdminDeps = {},
): Promise<ListRolesForAdminResult> {
  const admin = await requireAppAdmin(idToken, { verifyToken: deps.verifyToken, isSuperadmin: deps.isSuperadmin });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const includeArchived = input.includeArchived ?? true;
  if (typeof includeArchived !== "boolean") {
    return { ok: false, error: "invalid_input" };
  }

  try {
    const store = deps.store ?? getDefaultRoleStore();
    const window = await store.listWindow();

    const roles: RoleAdminDto[] = [];
    for (const doc of window.docs) {
      const parsed = parseStoredRoleDefinition(doc.data);
      if (!parsed.ok) continue;
      if (!includeArchived && parsed.role.archivedAt !== undefined) continue;
      roles.push(toAdminRoleDto(doc.id, parsed.role));
    }

    return { ok: true, roles, truncated: window.rawCount > ROLE_LIST_WINDOW };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

import { parseStoredRoleDefinition, ROLE_LIST_WINDOW, toRoleDto, type RoleDto } from "../domain/role-definition";
import { getDefaultRoleStore } from "./role-store";
import type { RoleStore } from "./role-store-types";

export interface ListActiveRolesDeps {
  store?: RoleStore;
}

export type ListActiveRolesResult =
  | { ok: true; roles: RoleDto[]; truncated: boolean }
  | { ok: false; error: "persistence_failed" };

/**
 * Org-wide catalog of active roles for any signed-in person. There is no subject parameter, and the caller's
 * authentication is enforced by the route. Archived and malformed documents are excluded without their content
 * reaching the output. `truncated` is set when a 51st raw document exists. Read failures surface as a neutral
 * `persistence_failed`.
 */
export async function listActiveRolesForPerson(deps: ListActiveRolesDeps = {}): Promise<ListActiveRolesResult> {
  try {
    const store = deps.store ?? getDefaultRoleStore();
    const window = await store.listWindow();

    const roles = window.docs.flatMap((doc) => {
      const parsed = parseStoredRoleDefinition(doc.data);
      if (!parsed.ok || parsed.role.archivedAt !== undefined) return [];
      return [toRoleDto({ roleId: doc.id, name: parsed.role.name, description: parsed.role.description })];
    });

    return { ok: true, roles, truncated: window.rawCount > ROLE_LIST_WINDOW };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

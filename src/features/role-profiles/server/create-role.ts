import { ROLE_DEFINITION_LIMIT, validateRoleDraft, type RoleAdminDto, type StoredRoleDefinition } from "../domain/role-definition";
import { requireAppAdmin, type RequireAppAdminDeps } from "../../teams/server/require-app-admin";
import { toAdminRoleDto } from "./role-admin-mapping";
import { getDefaultRoleWriteStore } from "./role-store";
import { writeRefusalFor } from "../../auth/server/erasure-write-fence";
import type { RoleStore } from "./role-store-types";
import { type AuthRefusal } from "../../auth/server/auth-refusal";

export interface CreateRoleDeps extends RequireAppAdminDeps {
  store?: RoleStore;
  now?: () => Date;
}

export type CreateRoleResult =
  | { ok: true; role: RoleAdminDto }
  | { ok: false; error: AuthRefusal | "forbidden" | "invalid_input" | "cap_reached" | "persistence_failed" };

/**
 * Admin-only role creation. Input is a title and an optional description only. Authorization runs first and writes
 * nothing on any refusal. The cap is count-then-create: a `count()` of 50 or more refuses the create. A small overshoot
 * under concurrent creates is accepted (same precedent as D1 goals).
 */
export async function createRole(idToken: string, input: unknown, deps: CreateRoleDeps = {}): Promise<CreateRoleResult> {
  const admin = await requireAppAdmin(idToken, { verifyToken: deps.verifyToken, isSuperadmin: deps.isSuperadmin });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const validated = validateRoleDraft(input);
  if (!validated.ok) {
    return { ok: false, error: "invalid_input" };
  }

  try {
    const store = deps.store ?? getDefaultRoleWriteStore(admin.identity.uid);
    if ((await store.count()) >= ROLE_DEFINITION_LIMIT) {
      return { ok: false, error: "cap_reached" };
    }

    const stored: StoredRoleDefinition = {
      ...validated.draft,
      createdAt: (deps.now ?? (() => new Date()))(),
      createdBy: admin.identity.uid,
    };
    const roleId = await store.create(stored);
    return { ok: true, role: toAdminRoleDto(roleId, stored) };
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }
}

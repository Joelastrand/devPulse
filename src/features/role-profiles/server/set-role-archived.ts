import { parseStoredRoleDefinition, type RoleAdminDto, type RoleDefinition } from "../domain/role-definition";
import { requireAppAdmin, type RequireAppAdminDeps } from "../../teams/server/require-app-admin";
import { toAdminRoleDto } from "./role-admin-mapping";
import { getDefaultRoleStore } from "./role-store";
import { isAddressableRoleId, type RoleStore } from "./role-store-types";
import { getDefaultSkillTreeReader } from "./skill-tree-seam";
import { resolveSkillTreeReferences, type RawSkillTreeReader } from "./skill-tree-seam-types";

export interface SetRoleArchivedDeps extends RequireAppAdminDeps {
  store?: RoleStore;
  treeReader?: RawSkillTreeReader;
  now?: () => Date;
}

export type SetRoleArchivedResult =
  | { ok: true; role: RoleAdminDto }
  | { ok: false; error: "unauthenticated" | "forbidden" | "invalid_input" | "not_found" | "persistence_failed" };

/**
 * Admin archive or restore (BR-5, AD-6, PG-6). Archive sets `archivedAt` and `archivedBy`; restore removes both.
 * Both are idempotent `200` no-ops when the role is already in the requested state, and a no-op writes nothing,
 * so `updatedAt` is not touched. Archiving never modifies any person's stored target. A missing or malformed
 * role is `not_found` (PG-9). `createdAt` is never changed.
 */
export async function setRoleArchived(
  idToken: string,
  roleId: string,
  archived: unknown,
  deps: SetRoleArchivedDeps = {},
): Promise<SetRoleArchivedResult> {
  const admin = await requireAppAdmin(idToken, { verifyToken: deps.verifyToken, allowList: deps.allowList });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }
  if (typeof archived !== "boolean") {
    return { ok: false, error: "invalid_input" };
  }
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
    const isArchived = current.archivedAt !== undefined;
    const now = (deps.now ?? (() => new Date()))();

    if (archived && !isArchived) {
      await store.update(roleId, { set: { archivedAt: now, archivedBy: admin.identity.uid }, unset: [] });
    } else if (!archived && isArchived) {
      await store.update(roleId, { set: {}, unset: ["archivedAt", "archivedBy"] });
    }

    const references = await resolveSkillTreeReferences(
      current.expectations.map((expectation) => expectation.treeId),
      deps.treeReader ?? getDefaultSkillTreeReader(),
    );
    const next: RoleDefinition = { ...current, archivedAt: archived ? (current.archivedAt ?? now) : undefined };
    return { ok: true, role: toAdminRoleDto(roleId, next, references) };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

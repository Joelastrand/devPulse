import { parseStoredRoleDefinition, ROLE_LIST_WINDOW, type RoleAdminDto, type RoleDefinition } from "../domain/role-definition";
import { requireAppAdmin, type RequireAppAdminDeps } from "../../teams/server/require-app-admin";
import { toAdminRoleDto } from "./role-admin-mapping";
import { getDefaultRoleStore } from "./role-store";
import type { RoleStore } from "./role-store-types";
import { getDefaultSkillTreeReader } from "./skill-tree-seam";
import { resolveSkillTreeReferences, type RawSkillTreeReader } from "./skill-tree-seam-types";

export interface ListRolesForAdminDeps extends RequireAppAdminDeps {
  store?: RoleStore;
  treeReader?: RawSkillTreeReader;
}

export interface ListRolesForAdminInput {
  includeArchived?: unknown;
}

export type ListRolesForAdminResult =
  | { ok: true; roles: RoleAdminDto[]; truncated: boolean }
  | { ok: false; error: "unauthenticated" | "forbidden" | "invalid_input" | "persistence_failed" };

interface ReadableRole {
  roleId: string;
  role: RoleDefinition;
}

/**
 * Admin role list (BR-21, BR-22). Reads the 50-document window with `orderBy createdAt` and a 51-document probe.
 * A stored document that fails validation is skipped silently and never exposed, but it still consumes a window
 * slot. `truncated` is set when a 51st raw document exists. `includeArchived` defaults to true and accepts only a
 * boolean. Read failures surface as a neutral `persistence_failed`, never as a missing SkillTree.
 */
export async function listRolesForAdmin(
  idToken: string,
  input: ListRolesForAdminInput = {},
  deps: ListRolesForAdminDeps = {},
): Promise<ListRolesForAdminResult> {
  const admin = await requireAppAdmin(idToken, { verifyToken: deps.verifyToken, allowList: deps.allowList });
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

    const readable: ReadableRole[] = [];
    for (const doc of window.docs) {
      const parsed = parseStoredRoleDefinition(doc.data);
      if (!parsed.ok) continue;
      if (!includeArchived && parsed.role.archivedAt !== undefined) continue;
      readable.push({ roleId: doc.id, role: parsed.role });
    }

    const references = await resolveSkillTreeReferences(
      readable.flatMap(({ role }) => role.expectations.map((expectation) => expectation.treeId)),
      deps.treeReader ?? getDefaultSkillTreeReader(),
    );

    return {
      ok: true,
      roles: readable.map(({ roleId, role }) => toAdminRoleDto(roleId, role, references)),
      truncated: window.rawCount > ROLE_LIST_WINDOW,
    };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

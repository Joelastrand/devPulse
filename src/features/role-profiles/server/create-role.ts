import { ROLE_DEFINITION_LIMIT, validateRoleDraft, type RoleAdminDto, type StoredRoleDefinition } from "../domain/role-definition";
import { requireAppAdmin, type RequireAppAdminDeps } from "../../teams/server/require-app-admin";
import { toAdminRoleDto } from "./role-admin-mapping";
import { getDefaultRoleStore } from "./role-store";
import type { RoleStore } from "./role-store-types";
import { getDefaultSkillTreeReader } from "./skill-tree-seam";
import { resolveSkillTreeReferences, type RawSkillTreeReader } from "./skill-tree-seam-types";

export interface CreateRoleDeps extends RequireAppAdminDeps {
  store?: RoleStore;
  treeReader?: RawSkillTreeReader;
  now?: () => Date;
}

export type CreateRoleResult =
  | { ok: true; role: RoleAdminDto }
  | {
      ok: false;
      error: "unauthenticated" | "forbidden" | "invalid_input" | "skill_not_found" | "cap_reached" | "persistence_failed";
    };

/**
 * Admin-only role creation (BR-1, BR-2, BR-7). Authorization runs first and writes nothing on any refusal.
 * Every referenced `treeId` must resolve to a valid SkillTree, otherwise nothing is written. The cap is
 * count-then-create: a `count()` of 50 or more refuses the create (BR-7). A small overshoot under concurrent
 * creates is accepted (same precedent as D1 goals). Persistence and read failures surface only as a neutral
 * `persistence_failed`, never as a missing tree.
 */
export async function createRole(idToken: string, input: unknown, deps: CreateRoleDeps = {}): Promise<CreateRoleResult> {
  const admin = await requireAppAdmin(idToken, { verifyToken: deps.verifyToken, allowList: deps.allowList });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const validated = validateRoleDraft(input);
  if (!validated.ok) {
    return { ok: false, error: "invalid_input" };
  }
  const { draft } = validated;

  try {
    const store = deps.store ?? getDefaultRoleStore();
    const references = await resolveSkillTreeReferences(
      draft.expectations.map((expectation) => expectation.treeId),
      deps.treeReader ?? getDefaultSkillTreeReader(),
    );
    const everyTreeValid = draft.expectations.every(
      (expectation) => references.get(expectation.treeId)?.status === "valid",
    );
    if (!everyTreeValid) {
      return { ok: false, error: "skill_not_found" };
    }
    if ((await store.count()) >= ROLE_DEFINITION_LIMIT) {
      return { ok: false, error: "cap_reached" };
    }

    const stored: StoredRoleDefinition = {
      ...draft,
      createdAt: (deps.now ?? (() => new Date()))(),
      createdBy: admin.identity.uid,
    };
    const roleId = await store.create(stored);
    return { ok: true, role: toAdminRoleDto(roleId, stored, references) };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

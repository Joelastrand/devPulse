import { parseStoredRoleDefinition, ROLE_LIST_WINDOW, toRoleDto, type RoleDto } from "../domain/role-definition";
import { getDefaultRoleStore } from "./role-store";
import type { RoleStore } from "./role-store-types";
import { getDefaultSkillTreeReader } from "./skill-tree-seam";
import { resolveSkillTreeReferences, type RawSkillTreeReader } from "./skill-tree-seam-types";

export interface ListActiveRolesDeps {
  store?: RoleStore;
  treeReader?: RawSkillTreeReader;
}

export type ListActiveRolesResult =
  | { ok: true; roles: RoleDto[]; truncated: boolean }
  | { ok: false; error: "persistence_failed" };

/**
 * Org-wide catalog of active roles for any signed-in person (BR-5, BR-6). There is no subject parameter, and the
 * caller's authentication is enforced by the route. Archived and malformed documents are excluded without their
 * content reaching the output. A role is `selectable` only when at least one expectation resolves to a valid
 * SkillTree (PG-2), so a zero-expectation role is listed but not selectable. `truncated` is set when a 51st raw
 * document exists (PG-5). Read failures surface as a neutral `persistence_failed`.
 */
export async function listActiveRolesForPerson(deps: ListActiveRolesDeps = {}): Promise<ListActiveRolesResult> {
  try {
    const store = deps.store ?? getDefaultRoleStore();
    const window = await store.listWindow();

    const active = window.docs.flatMap((doc) => {
      const parsed = parseStoredRoleDefinition(doc.data);
      return parsed.ok && parsed.role.archivedAt === undefined ? [{ roleId: doc.id, role: parsed.role }] : [];
    });

    const references = await resolveSkillTreeReferences(
      active.flatMap(({ role }) => role.expectations.map((expectation) => expectation.treeId)),
      deps.treeReader ?? getDefaultSkillTreeReader(),
    );

    const roles = active.map(({ roleId, role }) => {
      const expectations = role.expectations.map(({ treeId, expectedLevel }) => {
        const reference = references.get(treeId);
        return { treeId, treeName: reference?.status === "valid" ? reference.name : null, expectedLevel };
      });
      return toRoleDto({
        roleId,
        name: role.name,
        description: role.description,
        selectable: expectations.some((expectation) => expectation.treeName !== null),
        expectations,
      });
    });

    return { ok: true, roles, truncated: window.rawCount > ROLE_LIST_WINDOW };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

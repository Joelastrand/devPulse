import { toRoleAdminDto, type RoleAdminDto, type RoleDefinition } from "../domain/role-definition";
import type { SkillTreeReference } from "./skill-tree-seam-types";

/**
 * Builds the admin DTO for one role. `treeName` is the SkillTree name only for a valid referenced tree and `null`
 * otherwise (BR-22). Internal audit fields of the stored document are never part of `RoleDefinition`, so they
 * cannot reach the DTO.
 */
export function toAdminRoleDto(
  roleId: string,
  role: RoleDefinition,
  references: ReadonlyMap<string, SkillTreeReference>,
): RoleAdminDto {
  return toRoleAdminDto({
    roleId,
    name: role.name,
    description: role.description,
    expectations: role.expectations.map(({ treeId, expectedLevel }) => {
      const reference = references.get(treeId);
      return { treeId, treeName: reference?.status === "valid" ? reference.name : null, expectedLevel };
    }),
    archived: role.archivedAt !== undefined,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  });
}

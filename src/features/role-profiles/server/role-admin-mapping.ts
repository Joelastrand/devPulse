import { toRoleAdminDto, type RoleAdminDto, type RoleDefinition } from "../domain/role-definition";

/**
 * Builds the admin DTO for one role. Internal audit fields of the stored document are never part of `RoleDefinition`,
 * so they cannot reach the DTO.
 */
export function toAdminRoleDto(roleId: string, role: RoleDefinition): RoleAdminDto {
  return toRoleAdminDto({
    roleId,
    name: role.name,
    description: role.description,
    archived: role.archivedAt !== undefined,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  });
}

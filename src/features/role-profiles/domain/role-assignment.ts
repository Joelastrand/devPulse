/**
 * Formal organizational role assignment (docs/archive/features/role-profiles/SPEC.md, "Formal role assignment"). One document per
 * user at `roleAssignments/{uid}`, holding a stable `roleId` reference. An assignment is organizational information only:
 * it grants no application permission and nothing reads it for authorization, skills or goals.
 */

/** Persisted assignment, as read from Firestore. `roleId` is the stable role document id, never a title. */
export interface StoredRoleAssignment {
  roleId: string;
  createdAt: Date;
  createdBy: string;
  updatedAt?: Date;
  updatedBy?: string;
}

/** Admin write body: the only accepted field is the role id. The target uid comes from the route, never the body. */
export interface RoleAssignmentDraft {
  roleId: string;
}

export type ValidateRoleAssignmentDraftResult = { ok: true; draft: RoleAssignmentDraft } | { ok: false };

/** A bounded set of uids accepted by the admin lookup. Keeps one request's read cost fixed (SPEC: reads are bounded). */
export const ROLE_ASSIGNMENT_LOOKUP_MAX = 100;

/** A uid is a Firebase Auth uid: non-empty, no path separator, bounded length. Anything else is refused. */
export function isAddressableUid(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !/^__.*__$/.test(value);
}

/** A role id as used for path segments. Same addressing rule as role catalogue ids. */
export function isAddressableRoleId(value: unknown): value is string {
  return isAddressableUid(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Admin body contract: exactly `{ roleId }`. Any other key is rejected so no audit field can be smuggled in. */
export function validateRoleAssignmentDraft(input: unknown): ValidateRoleAssignmentDraftResult {
  if (!isPlainObject(input)) return { ok: false };
  if (Object.keys(input).some((key) => key !== "roleId")) return { ok: false };
  if (!isAddressableRoleId(input.roleId)) return { ok: false };
  return { ok: true, draft: { roleId: input.roleId } };
}

/**
 * Readability contract over a stored assignment. Fail closed: a malformed document yields `ok: false` with no content.
 * Actor fields are validated for shape only and are never copied into a DTO.
 */
export function parseStoredRoleAssignment(data: unknown): { ok: true; assignment: StoredRoleAssignment } | { ok: false } {
  if (!isPlainObject(data)) return { ok: false };
  const allowed = new Set(["roleId", "createdAt", "createdBy", "updatedAt", "updatedBy"]);
  if (Object.keys(data).some((key) => !allowed.has(key))) return { ok: false };
  const { roleId, createdAt, createdBy, updatedAt, updatedBy } = data;
  if (!isAddressableRoleId(roleId)) return { ok: false };
  if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) return { ok: false };
  if (typeof createdBy !== "string" || createdBy.length === 0) return { ok: false };
  if (updatedAt !== undefined && (!(updatedAt instanceof Date) || Number.isNaN(updatedAt.getTime()))) return { ok: false };
  if (updatedBy !== undefined && (typeof updatedBy !== "string" || updatedBy.length === 0)) return { ok: false };
  const assignment: StoredRoleAssignment = { roleId, createdAt, createdBy };
  if (updatedAt !== undefined) assignment.updatedAt = updatedAt;
  if (updatedBy !== undefined) assignment.updatedBy = updatedBy as string;
  return { ok: true, assignment };
}

/** The admin-facing view of one assignment: the role reference only. */
export interface RoleAssignmentAdminDto {
  roleId: string;
}

/** The personal view: the role's title and description, nothing else. No role id, no audit fields, no uid. */
export interface OwnRoleAssignmentDto {
  status: "assigned" | "none";
  title?: string;
  description?: string;
}

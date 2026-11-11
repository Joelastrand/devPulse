/**
 * Organizational role definitions (role-profiles). A role is only a title and an optional description. It does not
 * define skill requirements, expected levels, competence mappings, targets or any assessment (see
 * docs/features/role-profiles/SPEC.md). Stored `name` is the user-facing title.
 */

/** Role limits. Code constants only, never configurable by request, setting or env var. */
export const ROLE_DEFINITION_LIMIT = 50;
export const ROLE_LIST_WINDOW = 50;
export const ROLE_NAME_MIN = 1;
export const ROLE_NAME_MAX = 80;
export const ROLE_DESCRIPTION_MAX = 500;

/** Domain role: validated content only. Internal audit fields (`createdBy`, `updatedBy`, `archivedBy`) are not part of it. */
export interface RoleDefinition {
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt?: Date;
  archivedAt?: Date;
}

/** Persisted role-definition document, keyed by `roleId`, as read from Firestore. Timestamps are already `Date`s. */
export interface StoredRoleDefinition extends RoleDefinition {
  createdBy: string | null;
  updatedBy?: string | null;
  archivedBy?: string | null;
}

/** Browser-facing role for active roles. Explicit allow-list; built only by `toRoleDto`. */
export interface RoleDto {
  roleId: string;
  name: string;
  description?: string;
}

export type NormalizeRoleNameResult = { ok: true; name: string } | { ok: false };
export type NormalizeRoleDescriptionResult = { ok: true; description?: string } | { ok: false };
export type ParseStoredRoleDefinitionResult = { ok: true; role: RoleDefinition } | { ok: false };

const ROLE_KEYS: ReadonlySet<string> = new Set(["name", "description", "createdAt", "updatedAt", "createdBy", "updatedBy", "archivedAt", "archivedBy"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

/**
 * Title contract: trim, then 1–80 code points. Code points are counted with `Array.from`.
 */
export function normalizeRoleName(input: unknown): NormalizeRoleNameResult {
  if (typeof input !== "string") {
    return { ok: false };
  }
  const name = input.trim();
  const length = Array.from(name).length;
  if (length < ROLE_NAME_MIN || length > ROLE_NAME_MAX) {
    return { ok: false };
  }
  return { ok: true, name };
}

/**
 * Description contract: trim, then at most 500 code points. An empty result after trimming means the description is
 * absent, so no empty string is ever stored or returned.
 */
export function normalizeRoleDescription(input: unknown): NormalizeRoleDescriptionResult {
  if (input === undefined) {
    return { ok: true };
  }
  if (typeof input !== "string") {
    return { ok: false };
  }
  const description = input.trim();
  if (description.length === 0) {
    return { ok: true };
  }
  if (Array.from(description).length > ROLE_DESCRIPTION_MAX) {
    return { ok: false };
  }
  return { ok: true, description };
}

/**
 * Readability contract over a stored document whose timestamps are already `Date`s. Fail closed and content-free:
 * the result carries no reason and no raw value. Never repairs or normalises. Any unknown key, including the
 * obsolete `expectations` field, makes the document malformed. Internal audit fields are validated for shape but are
 * not copied into the returned domain role.
 */
export function parseStoredRoleDefinition(data: unknown): ParseStoredRoleDefinitionResult {
  if (!isPlainObject(data) || !hasOnlyKeys(data, ROLE_KEYS)) {
    return { ok: false };
  }
  const { name, description, createdAt, updatedAt, createdBy, updatedBy, archivedAt, archivedBy } = data;

  const normalizedName = normalizeRoleName(name);
  if (!normalizedName.ok || normalizedName.name !== name) {
    return { ok: false };
  }
  const normalizedDescription = normalizeRoleDescription(description);
  if (!normalizedDescription.ok || normalizedDescription.description !== description) {
    return { ok: false };
  }
  // An actor field is a uid, or exactly `null` once that account was erased (account-erasure SPEC A-3).
  if (!isValidDate(createdAt) || !isNullableActor(createdBy)) {
    return { ok: false };
  }
  if (updatedAt !== undefined && (!isValidDate(updatedAt) || updatedAt < createdAt)) {
    return { ok: false };
  }
  if (updatedBy !== undefined && !isNullableActor(updatedBy)) {
    return { ok: false };
  }
  if (archivedAt !== undefined && !isValidDate(archivedAt)) {
    return { ok: false };
  }
  if (archivedBy !== undefined && !isNullableActor(archivedBy)) {
    return { ok: false };
  }

  const role: RoleDefinition = { name: normalizedName.name, createdAt };
  if (normalizedDescription.description !== undefined) {
    role.description = normalizedDescription.description;
  }
  if (updatedAt !== undefined) {
    role.updatedAt = updatedAt;
  }
  if (archivedAt !== undefined) {
    role.archivedAt = archivedAt;
  }
  return { ok: true, role };
}

/** The only way to produce a `RoleDto`. Copies named fields only; `description` is omitted when absent. */
export function toRoleDto(input: RoleDto): RoleDto {
  const dto: RoleDto = { roleId: input.roleId, name: input.name };
  if (input.description !== undefined) {
    dto.description = input.description;
  }
  return dto;
}

/** Admin-facing role. Same allow-list discipline as `RoleDto`; adds lifecycle fields only. */
export interface RoleAdminDto {
  roleId: string;
  name: string;
  description?: string;
  archived: boolean;
  createdAt: Date;
  updatedAt?: Date;
}

export interface RoleAdminDtoInput {
  roleId: string;
  name: string;
  description?: string;
  archived: boolean;
  createdAt: Date;
  updatedAt?: Date;
}

/** The only way to produce a `RoleAdminDto`. Copies named fields only; absent optionals are omitted. */
export function toRoleAdminDto(input: RoleAdminDtoInput): RoleAdminDto {
  const dto: RoleAdminDto = {
    roleId: input.roleId,
    name: input.name,
    archived: input.archived,
    createdAt: input.createdAt,
  };
  if (input.description !== undefined) {
    dto.description = input.description;
  }
  if (input.updatedAt !== undefined) {
    dto.updatedAt = input.updatedAt;
  }
  return dto;
}

export interface RoleDraft {
  name: string;
  description?: string;
}

export type ValidateRoleDraftResult = { ok: true; draft: RoleDraft } | { ok: false };

const DRAFT_KEYS: ReadonlySet<string> = new Set(["name", "description"]);

/**
 * Admin create/edit body contract. `name` (the title) is required; `description` is optional. Any other key is
 * rejected, including the obsolete `expectations`, so a client cannot smuggle audit or identity fields into a role.
 */
export function validateRoleDraft(input: unknown): ValidateRoleDraftResult {
  if (!isPlainObject(input) || !hasOnlyKeys(input, DRAFT_KEYS)) {
    return { ok: false };
  }
  const name = normalizeRoleName(input.name);
  const description = normalizeRoleDescription(input.description);
  if (!name.ok || !description.ok) {
    return { ok: false };
  }
  const draft: RoleDraft = { name: name.name };
  if (description.description !== undefined) {
    draft.description = description.description;
  }
  return { ok: true, draft };
}

/** A description change in a patch: replace with `set`, or remove the stored field with `clear`. */
export type RoleDescriptionChange = { set: string } | { clear: true };

export interface RolePatch {
  name?: string;
  description?: RoleDescriptionChange;
}

export type ValidateRolePatchResult = { ok: true; patch: RolePatch } | { ok: false };

const PATCH_KEYS: ReadonlySet<string> = new Set(["name", "description"]);

/**
 * Admin partial-edit contract. At least one of `name` or `description` must be present, so an empty body is rejected.
 * A `description` that trims to empty is a `clear`.
 */
export function validateRolePatch(input: unknown): ValidateRolePatchResult {
  if (!isPlainObject(input) || !hasOnlyKeys(input, PATCH_KEYS) || Object.keys(input).length === 0) {
    return { ok: false };
  }
  const patch: RolePatch = {};
  if ("name" in input) {
    const name = normalizeRoleName(input.name);
    if (!name.ok) return { ok: false };
    patch.name = name.name;
  }
  if ("description" in input) {
    const description = normalizeRoleDescription(input.description);
    if (!description.ok) return { ok: false };
    patch.description = description.description === undefined ? { clear: true } : { set: description.description };
  }
  return { ok: true, patch };
}

/** An actor uid, or exactly `null` once that account was erased (account-erasure SPEC A-3). */
function isNullableActor(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

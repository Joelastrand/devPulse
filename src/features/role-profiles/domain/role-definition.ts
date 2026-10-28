/** Role limits (SPEC BR-2, BR-7, BR-22, AD-5). Code constants only, never configurable by request, setting or env var. */
export const ROLE_DEFINITION_LIMIT = 50;
export const ROLE_LIST_WINDOW = 50;
export const ROLE_NAME_MIN = 1;
export const ROLE_NAME_MAX = 80;
export const ROLE_DESCRIPTION_MAX = 500;
export const ROLE_EXPECTATIONS_MAX = 20;

/** Same syntactic shape as SkillTree `treeId`, mirrored from skill-profiles (BR-2). Existence is checked elsewhere. */
const TREE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type RoleExpectedLevel = 2 | 3 | 4;

export interface RoleExpectation {
  treeId: string;
  expectedLevel: RoleExpectedLevel;
}

/** Domain role: validated content only. Internal audit fields (`createdBy`, `updatedBy`, `archivedBy`) are not part of it. */
export interface RoleDefinition {
  name: string;
  description?: string;
  expectations: RoleExpectation[];
  createdAt: Date;
  updatedAt?: Date;
  archivedAt?: Date;
}

/** Persisted role-definition document, keyed by `roleId`, as read from Firestore (AD-1). Timestamps are already `Date`s. */
export interface StoredRoleDefinition extends RoleDefinition {
  createdBy: string;
  updatedBy?: string;
  archivedBy?: string;
}

/** Browser-facing role (BR-6). Explicit allow-list; built only by `toRoleDto`. */
export interface RoleDto {
  roleId: string;
  name: string;
  description?: string;
  selectable: boolean;
  expectations: RoleDtoExpectation[];
}

export interface RoleDtoExpectation {
  treeId: string;
  treeName: string | null;
  expectedLevel: RoleExpectedLevel;
}

export type NormalizeRoleNameResult = { ok: true; name: string } | { ok: false };
export type NormalizeRoleDescriptionResult = { ok: true; description?: string } | { ok: false };
export type ValidateRoleExpectationsResult = { ok: true; expectations: RoleExpectation[] } | { ok: false };
export type ParseStoredRoleDefinitionResult = { ok: true; role: RoleDefinition } | { ok: false };

const ROLE_KEYS: ReadonlySet<string> = new Set(["name", "description", "expectations", "createdAt", "updatedAt", "createdBy", "updatedBy", "archivedAt", "archivedBy"]);
const EXPECTATION_KEYS: ReadonlySet<string> = new Set(["treeId", "expectedLevel"]);

export function isWellFormedRoleTreeId(value: unknown): value is string {
  return typeof value === "string" && TREE_ID_PATTERN.test(value);
}

export function isRoleExpectedLevel(value: unknown): value is RoleExpectedLevel {
  return value === 2 || value === 3 || value === 4;
}

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
 * Name contract (BR-2): trim, then 1–80 code points. Code points are counted
 * with `Array.from`, the same convention as D1 goal titles (PG-10).
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
 * Description contract (BR-2, PG-10): trim, then at most 500 code points. An
 * empty result after trimming means the description is absent, so no empty
 * string is ever stored or returned.
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
 * Expectation contract (BR-2, BR-4, AD-5): zero to 20 entries, each an exact
 * `{ treeId, expectedLevel }` with a well-formed `treeId` and level 2–4, and
 * no `treeId` repeated within the role. Extra keys are rejected.
 */
export function validateRoleExpectations(input: unknown): ValidateRoleExpectationsResult {
  if (!Array.isArray(input) || input.length > ROLE_EXPECTATIONS_MAX) {
    return { ok: false };
  }
  const seen = new Set<string>();
  const expectations: RoleExpectation[] = [];
  for (const entry of input) {
    if (!isPlainObject(entry) || !hasOnlyKeys(entry, EXPECTATION_KEYS)) {
      return { ok: false };
    }
    const { treeId, expectedLevel } = entry;
    if (!isWellFormedRoleTreeId(treeId) || !isRoleExpectedLevel(expectedLevel) || seen.has(treeId)) {
      return { ok: false };
    }
    seen.add(treeId);
    expectations.push({ treeId, expectedLevel });
  }
  return { ok: true, expectations };
}

/**
 * Readability contract (BR-21) over a stored document whose timestamps are
 * already `Date`s. Fail closed and content-free: the result carries no reason
 * and no raw value. Never repairs or normalises; a stored value must already
 * be in its normalised form. Internal audit fields are validated for shape but
 * are not copied into the returned domain role.
 */
export function parseStoredRoleDefinition(data: unknown): ParseStoredRoleDefinitionResult {
  if (!isPlainObject(data) || !hasOnlyKeys(data, ROLE_KEYS)) {
    return { ok: false };
  }
  const { name, description, expectations, createdAt, updatedAt, createdBy, updatedBy, archivedAt, archivedBy } = data;

  const normalizedName = normalizeRoleName(name);
  if (!normalizedName.ok || normalizedName.name !== name) {
    return { ok: false };
  }
  const normalizedDescription = normalizeRoleDescription(description);
  if (!normalizedDescription.ok || normalizedDescription.description !== description) {
    return { ok: false };
  }
  const validExpectations = validateRoleExpectations(expectations);
  if (!validExpectations.ok) {
    return { ok: false };
  }
  if (!isValidDate(createdAt) || typeof createdBy !== "string" || createdBy.length === 0) {
    return { ok: false };
  }
  if (updatedAt !== undefined && (!isValidDate(updatedAt) || updatedAt < createdAt)) {
    return { ok: false };
  }
  if (updatedBy !== undefined && typeof updatedBy !== "string") {
    return { ok: false };
  }
  if (archivedAt !== undefined && !isValidDate(archivedAt)) {
    return { ok: false };
  }
  if (archivedBy !== undefined && typeof archivedBy !== "string") {
    return { ok: false };
  }

  const role: RoleDefinition = {
    name: normalizedName.name,
    expectations: validExpectations.expectations,
    createdAt,
  };
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

export interface RoleDtoInput {
  roleId: string;
  name: string;
  description?: string;
  selectable: boolean;
  expectations: RoleDtoExpectation[];
}

/**
 * The only way to produce a `RoleDto` (BR-6). Copies named fields only, so
 * audit or identity fields on the source never reach the browser. `description`
 * is omitted, not set to `undefined`, when absent.
 */
export function toRoleDto(input: RoleDtoInput): RoleDto {
  const dto: RoleDto = {
    roleId: input.roleId,
    name: input.name,
    selectable: input.selectable,
    expectations: input.expectations.map((expectation) => ({
      treeId: expectation.treeId,
      treeName: expectation.treeName,
      expectedLevel: expectation.expectedLevel,
    })),
  };
  if (input.description !== undefined) {
    dto.description = input.description;
  }
  return dto;
}

/** Admin-facing role (SPEC API surface). Same allow-list discipline as `RoleDto`; adds lifecycle fields only. */
export interface RoleAdminDto {
  roleId: string;
  name: string;
  description?: string;
  expectations: RoleDtoExpectation[];
  archived: boolean;
  createdAt: Date;
  updatedAt?: Date;
}

export interface RoleAdminDtoInput {
  roleId: string;
  name: string;
  description?: string;
  expectations: RoleDtoExpectation[];
  archived: boolean;
  createdAt: Date;
  updatedAt?: Date;
}

/** The only way to produce a `RoleAdminDto`. Copies named fields only; absent optionals are omitted. */
export function toRoleAdminDto(input: RoleAdminDtoInput): RoleAdminDto {
  const dto: RoleAdminDto = {
    roleId: input.roleId,
    name: input.name,
    expectations: input.expectations.map((expectation) => ({
      treeId: expectation.treeId,
      treeName: expectation.treeName,
      expectedLevel: expectation.expectedLevel,
    })),
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
  expectations: RoleExpectation[];
}

export type ValidateRoleDraftResult = { ok: true; draft: RoleDraft } | { ok: false };

const DRAFT_KEYS: ReadonlySet<string> = new Set(["name", "description", "expectations"]);

/**
 * Admin create/edit body contract (SPEC API surface). `name` and `expectations` are required; `description` is
 * optional. Any other key is rejected, so a client cannot smuggle audit or identity fields into a role.
 */
export function validateRoleDraft(input: unknown): ValidateRoleDraftResult {
  if (!isPlainObject(input) || !hasOnlyKeys(input, DRAFT_KEYS)) {
    return { ok: false };
  }
  const name = normalizeRoleName(input.name);
  const description = normalizeRoleDescription(input.description);
  const expectations = validateRoleExpectations(input.expectations);
  if (!name.ok || !description.ok || !expectations.ok) {
    return { ok: false };
  }
  const draft: RoleDraft = { name: name.name, expectations: expectations.expectations };
  if (description.description !== undefined) {
    draft.description = description.description;
  }
  return { ok: true, draft };
}

/** A description change in a patch: replace with `set`, or remove the stored field with `clear` (PG-10). */
export type RoleDescriptionChange = { set: string } | { clear: true };

export interface RolePatch {
  name?: string;
  description?: RoleDescriptionChange;
  expectations?: RoleExpectation[];
}

export type ValidateRolePatchResult = { ok: true; patch: RolePatch } | { ok: false };

const PATCH_KEYS: ReadonlySet<string> = new Set(["name", "description", "expectations"]);

/**
 * Admin partial-edit contract (SPEC API surface, PG-6, PG-10). At least one of `name`, `description` or
 * `expectations` must be present, so an empty body is rejected. A `description` that trims to empty is a `clear`.
 * `expectations`, when present, replaces the whole array.
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
  if ("expectations" in input) {
    const expectations = validateRoleExpectations(input.expectations);
    if (!expectations.ok) return { ok: false };
    patch.expectations = expectations.expectations;
  }
  return { ok: true, patch };
}

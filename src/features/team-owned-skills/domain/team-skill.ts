/**
 * Team-owned skill definitions and their persisted shape (docs/archive/features/team-owned-skills/SPEC.md §3.1).
 * Pure: no Firestore access. Every value crossing a trust boundary is validated here, fail closed.
 */

export const TEAM_SKILL_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;
export const TEAM_SKILLS_PER_TEAM_MAX = 100;
export const TEAM_SKILL_NAME_MIN = 2;
export const TEAM_SKILL_NAME_MAX = 80;
export const TEAM_SKILL_DESCRIPTION_MAX = 500;
export const TEAM_SKILL_CATEGORY_MAX = 60;
export const TEAM_SKILL_GUIDANCE_MAX = 300;
export const TEAM_SKILL_SORT_ORDER_MAX = 9999;

/** The existing four assessment levels. Not five; "not assessed" is the absence of a rating, never a level. */
export const TEAM_SKILL_LEVELS = [1, 2, 3, 4] as const;
export type TeamSkillLevel = (typeof TEAM_SKILL_LEVELS)[number];

export const TEAM_SKILL_GUIDANCE_KEYS = ["1", "2", "3", "4"] as const;
export type TeamSkillGuidance = Partial<Record<(typeof TEAM_SKILL_GUIDANCE_KEYS)[number], string>>;

/** A team skill as persisted (`teamSkills/{skillId}`). Dates are `Date` after mapping. */
export interface TeamSkillRecord {
  teamId: string;
  name: string;
  description: string;
  category: string | null;
  guidance: TeamSkillGuidance;
  criteriaVersion: number;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

/** Exact persisted key set. Compile-time checked against the record type below. */
export const TEAM_SKILL_PERSISTED_KEYS = {
  teamId: true,
  name: true,
  description: true,
  category: true,
  guidance: true,
  criteriaVersion: true,
  active: true,
  sortOrder: true,
  createdAt: true,
  createdBy: true,
  updatedAt: true,
  updatedBy: true,
} as const satisfies Record<keyof TeamSkillRecord, true>;

export type TeamSkillInputResult<T> = { ok: true; value: T } | { ok: false; error: "invalid_request" | "invalid_input" };

export function isTeamSkillLevel(value: unknown): value is TeamSkillLevel {
  return typeof value === "number" && (TEAM_SKILL_LEVELS as readonly number[]).includes(value);
}

export function isWellFormedTeamSkillId(value: unknown): value is string {
  return typeof value === "string" && TEAM_SKILL_ID_PATTERN.test(value);
}

/** Case- and whitespace-insensitive key used only to refuse accidental duplicates. Never an identity. */
export function normalizeTeamSkillName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** Trimmed string of length within [min, max], or `null`. */
function boundedText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null;
}

function parseGuidance(value: unknown): TeamSkillInputResult<TeamSkillGuidance> {
  if (!isPlainObject(value)) return { ok: false, error: "invalid_input" };
  const guidance: TeamSkillGuidance = {};
  for (const key of Object.keys(value)) {
    if (!(TEAM_SKILL_GUIDANCE_KEYS as readonly string[]).includes(key)) return { ok: false, error: "invalid_input" };
    const raw = value[key];
    if (raw === null || raw === "") continue;
    const text = boundedText(raw, 1, TEAM_SKILL_GUIDANCE_MAX);
    if (text === null) return { ok: false, error: "invalid_input" };
    guidance[key as keyof TeamSkillGuidance] = text;
  }
  return { ok: true, value: guidance };
}

/** Exact guidance equality after normalization. Only a change here bumps `criteriaVersion`. */
export function sameGuidance(a: TeamSkillGuidance, b: TeamSkillGuidance): boolean {
  return TEAM_SKILL_GUIDANCE_KEYS.every((key) => (a[key] ?? null) === (b[key] ?? null));
}

export interface CreateTeamSkillInput {
  name: string;
  description: string;
  category: string | null;
  guidance: TeamSkillGuidance;
}

/** Create body: `name` required; `description`, `category`, `guidance` optional. Unknown keys are refused. */
export function parseCreateTeamSkillBody(body: unknown): TeamSkillInputResult<CreateTeamSkillInput> {
  if (!isPlainObject(body)) return { ok: false, error: "invalid_request" };
  const allowed = new Set(["name", "description", "category", "guidance"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return { ok: false, error: "invalid_request" };

  const name = boundedText(body.name, TEAM_SKILL_NAME_MIN, TEAM_SKILL_NAME_MAX);
  if (name === null) return { ok: false, error: "invalid_input" };
  const description = parseDescription(body.description);
  if (!description.ok) return description;
  const category = parseCategory(body.category);
  if (!category.ok) return category;
  const guidance = body.guidance === undefined ? { ok: true as const, value: {} } : parseGuidance(body.guidance);
  if (!guidance.ok) return guidance;
  return { ok: true, value: { name, description: description.value, category: category.value, guidance: guidance.value } };
}

function parseDescription(value: unknown): TeamSkillInputResult<string> {
  if (value === undefined) return { ok: true, value: "" };
  const text = typeof value === "string" ? value.trim() : null;
  if (text === null || text.length > TEAM_SKILL_DESCRIPTION_MAX) return { ok: false, error: "invalid_input" };
  return { ok: true, value: text };
}

function parseCategory(value: unknown): TeamSkillInputResult<string | null> {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  const text = boundedText(value, 1, TEAM_SKILL_CATEGORY_MAX);
  return text === null ? { ok: false, error: "invalid_input" } : { ok: true, value: text };
}

/** A partial update. Every present key is validated; at least one key is required. */
export interface UpdateTeamSkillInput {
  name?: string;
  description?: string;
  category?: string | null;
  guidance?: TeamSkillGuidance;
  sortOrder?: number;
  active?: boolean;
}

export function parseUpdateTeamSkillBody(body: unknown): TeamSkillInputResult<UpdateTeamSkillInput> {
  if (!isPlainObject(body)) return { ok: false, error: "invalid_request" };
  const allowed = new Set(["name", "description", "category", "guidance", "sortOrder", "active"]);
  const keys = Object.keys(body);
  if (keys.length === 0 || keys.some((key) => !allowed.has(key))) return { ok: false, error: "invalid_request" };

  const patch: UpdateTeamSkillInput = {};
  if (body.name !== undefined) {
    const name = boundedText(body.name, TEAM_SKILL_NAME_MIN, TEAM_SKILL_NAME_MAX);
    if (name === null) return { ok: false, error: "invalid_input" };
    patch.name = name;
  }
  if (body.description !== undefined) {
    const description = parseDescription(body.description);
    if (!description.ok) return description;
    patch.description = description.value;
  }
  if (body.category !== undefined) {
    const category = parseCategory(body.category);
    if (!category.ok) return category;
    patch.category = category.value;
  }
  if (body.guidance !== undefined) {
    const guidance = parseGuidance(body.guidance);
    if (!guidance.ok) return guidance;
    patch.guidance = guidance.value;
  }
  if (body.sortOrder !== undefined) {
    const order = body.sortOrder;
    if (!Number.isInteger(order) || (order as number) < 0 || (order as number) > TEAM_SKILL_SORT_ORDER_MAX) {
      return { ok: false, error: "invalid_input" };
    }
    patch.sortOrder = order as number;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") return { ok: false, error: "invalid_input" };
    patch.active = body.active;
  }
  return { ok: true, value: patch };
}

/** Level body: exactly `{ level }`. */
export function parseSetTeamSkillLevelBody(body: unknown): TeamSkillInputResult<{ level: TeamSkillLevel }> {
  if (!isPlainObject(body)) return { ok: false, error: "invalid_request" };
  if (Object.keys(body).some((key) => key !== "level")) return { ok: false, error: "invalid_request" };
  if (!isTeamSkillLevel(body.level)) return { ok: false, error: "invalid_input" };
  return { ok: true, value: { level: body.level } };
}

/**
 * Fail-closed validation of a stored definition. Timestamps must already be `Date`. Extra or missing keys, a wrong
 * team, a malformed id, or any out-of-range value makes the document invalid. Never throws.
 */
export function isValidTeamSkillRecord(data: unknown, context: { teamId: string; skillId: string }): data is TeamSkillRecord {
  try {
    if (!isPlainObject(data)) return false;
    const expected = Object.keys(TEAM_SKILL_PERSISTED_KEYS);
    if (Object.keys(data).length !== expected.length || !expected.every((key) => Object.hasOwn(data, key))) return false;
    if (!isWellFormedTeamSkillId(context.skillId) || data.teamId !== context.teamId) return false;
    const guidanceOk = isPlainObject(data.guidance) && parseGuidance(data.guidance).ok;
    const categoryOk = data.category === null || boundedText(data.category, 1, TEAM_SKILL_CATEGORY_MAX) !== null;
    const actorOk = (value: unknown) => value === null || (typeof value === "string" && value.length > 0);
    return (
      boundedText(data.name, TEAM_SKILL_NAME_MIN, TEAM_SKILL_NAME_MAX) !== null &&
      typeof data.description === "string" &&
      data.description.length <= TEAM_SKILL_DESCRIPTION_MAX &&
      categoryOk &&
      guidanceOk &&
      Number.isInteger(data.criteriaVersion) &&
      (data.criteriaVersion as number) >= 1 &&
      typeof data.active === "boolean" &&
      Number.isInteger(data.sortOrder) &&
      (data.sortOrder as number) >= 0 &&
      (data.sortOrder as number) <= TEAM_SKILL_SORT_ORDER_MAX &&
      isValidDate(data.createdAt) &&
      isValidDate(data.updatedAt) &&
      actorOk(data.createdBy) &&
      actorOk(data.updatedBy)
    );
  } catch {
    return false;
  }
}

/** Compact, storage-safe guidance: only non-empty entries, keys in level order. */
export function toStoredGuidance(guidance: TeamSkillGuidance): TeamSkillGuidance {
  const stored: TeamSkillGuidance = {};
  for (const key of TEAM_SKILL_GUIDANCE_KEYS) {
    const text = guidance[key];
    if (text !== undefined) stored[key] = text;
  }
  return stored;
}

import { isWellFormedTreeId } from "../../skill-profiles/domain/skill-profile";

/** Personal-scale levels a need may require. `1` is excluded on purpose (SPEC BR-2). */
export const REQUIRED_LEVELS = [2, 3, 4] as const;
export type RequiredLevel = (typeof REQUIRED_LEVELS)[number];

export const REQUIRED_COVERAGE_MIN = 1;
export const REQUIRED_COVERAGE_MAX = 20;

/**
 * The persisted `skillNeeds/{teamId}__{treeId}` shape (SPEC BR-1): one team's
 * need for one competency area. No actor, owner, status, archive marker or
 * derived value exists; coverage is derived per read, never stored.
 */
export interface SkillNeedRecord {
  teamId: string;
  treeId: string;
  requiredLevel: RequiredLevel;
  requiredCoverage: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Compile-time exhaustive key map: adding or removing a field fails typecheck. */
export const SKILL_NEED_PERSISTED_KEYS = {
  teamId: true,
  treeId: true,
  requiredLevel: true,
  requiredCoverage: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Record<keyof SkillNeedRecord, true>;

export function isRequiredLevel(value: unknown): value is RequiredLevel {
  return typeof value === "number" && (REQUIRED_LEVELS as readonly number[]).includes(value);
}

export function isRequiredCoverage(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= REQUIRED_COVERAGE_MIN &&
    value <= REQUIRED_COVERAGE_MAX
  );
}

/**
 * Deterministic document id: a uniqueness/integrity device ONLY. It is never
 * parsed apart and is never proof of authorization.
 */
export function skillNeedDocId(teamId: string, treeId: string): string {
  return `${teamId}__${treeId}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Fail-closed validation of untrusted persisted data (SPEC BR-1). Timestamps
 * must already be mapped to `Date` (repository convention). The stored
 * identity must be well-formed and its composite must equal `docId`. Never
 * throws; anything else — extra/missing keys included — is invalid.
 */
export function isValidSkillNeed(data: unknown, context: { docId: string }): data is SkillNeedRecord {
  try {
    if (!isPlainObject(data)) return false;
    const keys = Object.keys(data);
    const expected = Object.keys(SKILL_NEED_PERSISTED_KEYS);
    if (keys.length !== expected.length || !expected.every((key) => Object.hasOwn(data, key))) return false;
    const { teamId, treeId } = data;
    if (typeof teamId !== "string" || teamId.length === 0 || !isWellFormedTreeId(treeId)) return false;
    return (
      typeof context?.docId === "string" &&
      skillNeedDocId(teamId, treeId) === context.docId &&
      isRequiredLevel(data.requiredLevel) &&
      isRequiredCoverage(data.requiredCoverage) &&
      isValidDate(data.createdAt) &&
      isValidDate(data.updatedAt)
    );
  } catch {
    return false;
  }
}

export type ParseSkillNeedInputResult =
  | { ok: true; requiredLevel: RequiredLevel; requiredCoverage: number }
  | { ok: false; error: "invalid_request" | "invalid_input" };

const INPUT_KEYS = ["requiredLevel", "requiredCoverage"] as const;

/**
 * Strict allow-list parse of a PUT body (SPEC BR-2). Envelope problems (not a
 * plain object, missing or extra keys) ⇒ `invalid_request`; value problems
 * (wrong type, out of range, non-integer) ⇒ `invalid_input`. Nothing is
 * coerced or defaulted.
 */
export function parseSkillNeedInput(body: unknown): ParseSkillNeedInputResult {
  if (!isPlainObject(body)) return { ok: false, error: "invalid_request" };
  const keys = Object.keys(body);
  if (keys.length !== INPUT_KEYS.length || !INPUT_KEYS.every((key) => Object.hasOwn(body, key))) {
    return { ok: false, error: "invalid_request" };
  }
  const { requiredLevel, requiredCoverage } = body;
  if (!isRequiredLevel(requiredLevel) || !isRequiredCoverage(requiredCoverage)) {
    return { ok: false, error: "invalid_input" };
  }
  return { ok: true, requiredLevel, requiredCoverage };
}

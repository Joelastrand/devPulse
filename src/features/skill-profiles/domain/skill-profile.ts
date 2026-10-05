import { isSelfAssessedLevel, type SelfAssessedLevel } from "./self-assessed-level";

/** Exact persisted key set of `skillProfiles/{uid}` (SPEC BR-6). */
export const SKILL_PROFILE_PERSISTED_KEYS = ["levels", "createdAt", "updatedAt"] as const;

const TREE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Syntactic check only (SPEC BR-15). It says nothing about whether the tree
 * exists, is valid, or is visible in the bounded catalog.
 */
export function isWellFormedTreeId(value: unknown): value is string {
  return typeof value === "string" && TREE_ID_PATTERN.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export type SkillProfileRecordRead =
  | { readable: true; levels: Readonly<Record<string, unknown>> }
  | { readable: false };

/**
 * Document semantics (SPEC BR-10). Readability depends only on the `levels`
 * container: absent → empty map, plain object → readable, anything else →
 * unreadable. Timestamps and unknown top-level fields never affect it.
 * Individual entries are NOT validated here (BR-9: see `selectVisibleLevels`).
 * `undefined` is an absent document, which is the normal empty profile.
 */
export function readSkillProfileRecord(data: Readonly<Record<string, unknown>> | undefined): SkillProfileRecordRead {
  const levels = data?.levels;
  if (levels === undefined) return { readable: true, levels: {} };
  if (isPlainObject(levels)) return { readable: true, levels };
  return { readable: false };
}

/**
 * Whether the stored `createdAt` is a usable date (a valid `Date` or a
 * Timestamp-like with `toDate()`), so a write knows if it must repair it.
 */
export function hasValidCreatedAt(data: Readonly<Record<string, unknown>> | undefined): boolean {
  const value = data?.createdAt;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value !== "object" || value === null) return false;
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate !== "function") return false;
  try {
    const date: unknown = toDate.call(value);
    return date instanceof Date && !Number.isNaN(date.getTime());
  } catch {
    return false;
  }
}

/**
 * Entry semantics (SPEC BR-9): for each visible skill, its stored level if the
 * value is a valid level, otherwise `null`. Keys outside the visible set and
 * invalid values are ignored; no reason for absence is inferred. Only own
 * properties are read, so ids like "constructor" cannot match inherited ones.
 */
export function selectVisibleLevels(
  visibleTreeIds: Iterable<string>,
  levels: Readonly<Record<string, unknown>>,
): Map<string, SelfAssessedLevel | null> {
  const result = new Map<string, SelfAssessedLevel | null>();
  for (const treeId of visibleTreeIds) {
    const stored = Object.hasOwn(levels, treeId) ? levels[treeId] : undefined;
    result.set(treeId, isSelfAssessedLevel(stored) ? stored : null);
  }
  return result;
}

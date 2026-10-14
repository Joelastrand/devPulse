/** D1 limits (SPEC "Key concepts"). Code constants only — never configurable by request, setting or env var. */
export const GOAL_LIMIT = 100;
export const GOAL_READ_WINDOW = 100;
export const GOAL_TITLE_MIN = 1;
export const GOAL_TITLE_MAX = 100;
export const GOAL_BODY_MAX_BYTES = 4096;
export const SKILL_OPTIONS_WINDOW = 500;

/** A path `goalId` is addressable only if it matches this (BR-27a, BR-63). */
export const GOAL_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * BR-27a/BR-63: the pattern, minus ids Firestore reserves (`__x__`). SPEC BR-27a states that `__x__` never
 * reaches the SDK, and Firestore rejects such ids, so they are shape-invalid even though the pattern admits them.
 */
export function isAddressableGoalId(value: unknown): value is string {
  return typeof value === "string" && GOAL_ID_PATTERN.test(value) && !/^__.*__$/.test(value);
}

/** Exactly the persisted keys of a goal document (BR-6). `completedAt` only when completed. */
export const GOAL_PERSISTED_KEYS = [
  "title",
  "status",
  "createdAt",
  "updatedAt",
  "treeId",
  "targetDate",
  "completedAt",
] as const;

/** Exactly the keys of a `GoalDto` (BR-24). */
export const GOAL_DTO_KEYS = [
  "id",
  "title",
  "status",
  "treeId",
  "areaName",
  "areaAvailable",
  "targetDate",
  "createdAt",
  "updatedAt",
  "completedAt",
] as const;

/** Exactly the keys of a `GoalRecoveryDto` (BR-57). */
export const GOAL_RECOVERY_DTO_KEYS = ["goalId"] as const;

/** Exactly the keys of the `GET /api/me/goals` envelope (BR-25). */
export const GOAL_LIST_RESPONSE_KEYS = [
  "goals",
  "recoveryItems",
  "truncated",
  "skillOptions",
  "skillOptionsTruncated",
] as const;

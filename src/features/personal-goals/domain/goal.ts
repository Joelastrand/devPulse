import { GOAL_PERSISTED_KEYS } from "./goal-constants";
import { isValidGoalTargetDate } from "./goal-target-date";
import { normalizeGoalTitle } from "./goal-title";

export type GoalStatus = "active" | "completed";

export function isGoalStatus(value: unknown): value is GoalStatus {
  return value === "active" || value === "completed";
}

/** Syntactic `treeId` shape only (BR-13): a non-empty string. Existence is checked elsewhere. */
export function isValidTreeIdShape(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

interface GoalFieldsBase {
  title: string;
  treeId?: string;
  targetDate?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A validated goal. The union makes the `completedAt` invariant (BR-6)
 * unrepresentable-when-wrong: only a completed goal has `completedAt`.
 * Timestamps are plain `Date`s; Firestore `Timestamp` conversion belongs to
 * the persistence layer (BR-14).
 */
export type ActiveGoal = GoalFieldsBase & { status: "active" };
export type CompletedGoal = GoalFieldsBase & { status: "completed"; completedAt: Date };
export type Goal = ActiveGoal | CompletedGoal;

export type ParseStoredGoalResult = { ok: true; goal: Goal } | { ok: false };

const PERSISTED_KEY_SET: ReadonlySet<string> = new Set(GOAL_PERSISTED_KEYS);

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

/**
 * Readability contract (BR-35) over a stored document whose timestamps are
 * already `Date`s. Fail closed and content-free: the result carries no reason
 * and no raw value, so callers can only classify readable vs malformed. A
 * `null` optional is malformed (writers delete fields, never null); a
 * property explicitly set to `undefined` is treated as absent (Firestore never
 * returns it). Never repairs or normalises.
 */
export function parseStoredGoal(data: unknown): ParseStoredGoalResult {
  if (!isPlainObject(data)) {
    return { ok: false };
  }
  for (const key of Object.keys(data)) {
    if (!PERSISTED_KEY_SET.has(key)) {
      return { ok: false };
    }
  }

  const { title, status, createdAt, updatedAt, treeId, targetDate, completedAt } = data;

  if (typeof title !== "string") {
    return { ok: false };
  }
  const normalized = normalizeGoalTitle(title);
  if (!normalized.ok || normalized.title !== title) {
    return { ok: false };
  }
  if (!isGoalStatus(status)) {
    return { ok: false };
  }
  if (!isValidDate(createdAt) || !isValidDate(updatedAt) || updatedAt < createdAt) {
    return { ok: false };
  }
  if (treeId !== undefined && !isValidTreeIdShape(treeId)) {
    return { ok: false };
  }
  if (targetDate !== undefined && !isValidGoalTargetDate(targetDate)) {
    return { ok: false };
  }

  const base: GoalFieldsBase = {
    title,
    createdAt: new Date(createdAt.getTime()),
    updatedAt: new Date(updatedAt.getTime()),
    ...(treeId !== undefined ? { treeId } : {}),
    ...(targetDate !== undefined ? { targetDate } : {}),
  };

  if (status === "active") {
    if (completedAt !== undefined) {
      return { ok: false };
    }
    return { ok: true, goal: { ...base, status } };
  }
  if (!isValidDate(completedAt) || completedAt < createdAt) {
    return { ok: false };
  }
  return { ok: true, goal: { ...base, status, completedAt: new Date(completedAt.getTime()) } };
}

/** Caller-validated fields of a new goal (title normalised, date/tree shape valid). */
export interface NewGoalFields {
  title: string;
  treeId?: string;
  targetDate?: string;
}

/** BR-15: active, no `completedAt`, `createdAt == updatedAt == now`. */
export function createGoal(fields: NewGoalFields, now: Date): ActiveGoal {
  return {
    status: "active",
    title: fields.title,
    ...(fields.treeId !== undefined ? { treeId: fields.treeId } : {}),
    ...(fields.targetDate !== undefined ? { targetDate: fields.targetDate } : {}),
    createdAt: new Date(now.getTime()),
    updatedAt: new Date(now.getTime()),
  };
}

/**
 * Caller-validated change (BR-22 shapes after validation). `treeId` /
 * `targetDate`: a string sets, `null` removes, `undefined` leaves unchanged.
 */
export interface GoalChange {
  title?: string;
  treeId?: string | null;
  targetDate?: string | null;
  status?: GoalStatus;
}

/** Stable, content-free reason a change was rejected (BR-64). Carries no goal content. */
export type GoalChangeRejection = "clock_regressed";

/**
 * `changed: false` with a `goal` is the approved no-op; a result with
 * `rejected` carries no goal at all, so a caller cannot mistake a rejected
 * change for a successful one or for a no-op.
 */
export type GoalChangeResult =
  | { changed: false; goal: Goal }
  | { changed: true; goal: Goal }
  | { changed: false; rejected: GoalChangeRejection };

/**
 * Pure lifecycle/edit transition (BR-16…BR-18). Only supplied fields change.
 * A result identical to the input is `changed: false` and returns the input
 * untouched (no write, `updatedAt` and `completedAt` preserved), whatever
 * `now` is. Otherwise, if `now` is earlier than `goal.createdAt` (or not a
 * valid time), the whole change is rejected with `clock_regressed` (BR-64) and
 * nothing is built. Otherwise `updatedAt = now` exactly once; completing sets `completedAt = now`,
 * reopening removes it, and edits of a completed goal preserve it.
 */
export function applyGoalChange(goal: Goal, change: GoalChange, now: Date): GoalChangeResult {
  const title = change.title ?? goal.title;
  const treeId = change.treeId === undefined ? goal.treeId : (change.treeId ?? undefined);
  const targetDate =
    change.targetDate === undefined ? goal.targetDate : (change.targetDate ?? undefined);
  const status = change.status ?? goal.status;

  const unchanged =
    title === goal.title &&
    treeId === goal.treeId &&
    targetDate === goal.targetDate &&
    status === goal.status;
  if (unchanged) {
    return { changed: false, goal };
  }
  if (!(now.getTime() >= goal.createdAt.getTime())) {
    return { changed: false, rejected: "clock_regressed" };
  }

  const base: GoalFieldsBase = {
    title,
    createdAt: new Date(goal.createdAt.getTime()),
    updatedAt: new Date(now.getTime()),
    ...(treeId !== undefined ? { treeId } : {}),
    ...(targetDate !== undefined ? { targetDate } : {}),
  };

  if (status === "active") {
    return { changed: true, goal: { ...base, status } };
  }
  const completedAt =
    goal.status === "completed" ? new Date(goal.completedAt.getTime()) : new Date(now.getTime());
  return { changed: true, goal: { ...base, status, completedAt } };
}

/** Persisted shape with domain `Date`s; exactly the BR-6 keys, optional keys omitted. */
export interface StoredGoalData {
  title: string;
  status: GoalStatus;
  createdAt: Date;
  updatedAt: Date;
  treeId?: string;
  targetDate?: string;
  completedAt?: Date;
}

/** Builds the persisted representation field by field (never a spread of the goal). */
export function toStoredGoalData(goal: Goal): StoredGoalData {
  return {
    title: goal.title,
    status: goal.status,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
    ...(goal.treeId !== undefined ? { treeId: goal.treeId } : {}),
    ...(goal.targetDate !== undefined ? { targetDate: goal.targetDate } : {}),
    ...(goal.status === "completed" ? { completedAt: goal.completedAt } : {}),
  };
}

/** Goal as returned to the owner (BR-24); `areaName`/`areaAvailable` are derived, never persisted. */
export interface GoalDto {
  id: string;
  title: string;
  status: GoalStatus;
  treeId: string | null;
  areaName: string | null;
  areaAvailable: boolean;
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** Delete-only recovery item for a malformed owner document (BR-57). Nothing but the opaque id. */
export interface GoalRecoveryDto {
  goalId: string;
}

export interface SkillOptionDto {
  treeId: string;
  name: string;
}

export interface GoalListResponse {
  goals: GoalDto[];
  recoveryItems: GoalRecoveryDto[];
  truncated: boolean;
  skillOptions: SkillOptionDto[];
  skillOptionsTruncated: boolean;
}

/**
 * Explicit field-by-field DTO (BR-24). `resolvedAreaName` is the resolved
 * name of `goal.treeId`, or `null` when that tree is unavailable; it is
 * ignored when the goal has no tree (then `areaName: null`,
 * `areaAvailable: true`).
 */
export function toGoalDto(id: string, goal: Goal, resolvedAreaName: string | null): GoalDto {
  const hasTree = goal.treeId !== undefined;
  return {
    id,
    title: goal.title,
    status: goal.status,
    treeId: goal.treeId ?? null,
    areaName: hasTree ? resolvedAreaName : null,
    areaAvailable: hasTree ? resolvedAreaName !== null : true,
    targetDate: goal.targetDate ?? null,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
    completedAt: goal.status === "completed" ? goal.completedAt.toISOString() : null,
  };
}

export function toGoalRecoveryDto(goalId: string): GoalRecoveryDto {
  return { goalId };
}

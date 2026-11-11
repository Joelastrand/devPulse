import { isSelfAssessedLevel, type SelfAssessedLevel } from "../../skill-profiles/domain/self-assessed-level";
import { isWellFormedTreeId } from "../../skill-profiles/domain/skill-profile";
import { isRoadmapPriority, type RoadmapPriority } from "../../roadmap/domain/roadmap-item";
import { isValidPlanDate } from "../../roadmap/domain/roadmap-dates";

/**
 * Team competence development plan (docs/features/team-experience-redesign SPEC — BR-15, BR-16, BR-17; TASK-006).
 *
 * A plan is a team-level development goal for one admin-assigned competence area: a priority, a TARGET stage (the
 * existing four assessment levels, reused as-is) and an ordered list of planned milestones. A target stage is a goal,
 * never an observed assessment, and no member's self-assessment is read or copied here. The record holds no uid,
 * actor, rating or member data, so it is team-scoped planning state.
 *
 * Progress is the count of completed milestones out of the total. It is plan-step completion only, never a skill level.
 */

export const MILESTONE_STATUSES = ["planned", "in_progress", "completed"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const PLAN_MILESTONES_MAX = 20;
export const MILESTONE_TITLE_MAX_LENGTH = 200;

export interface PlanMilestone {
  /** Stable identifier, generated server-side. Never a person reference. */
  id: string;
  title: string;
  /** ISO calendar date (`YYYY-MM-DD`, Oslo planning convention) or `null`. */
  targetDate: string | null;
  status: MilestoneStatus;
}

/** Upper bound of a plan title, in characters after trimming. */
export const PLAN_TITLE_MAX_LENGTH = 120;

export interface CompetencePlan {
  teamId: string;
  /** Team-authored plan name. A plan needs no competence area, so the name is the plan's own. */
  title: string;
  /**
   * Optional label reference to the global skill catalog, kept from plans created before plans became independent.
   * `null` for every plan created now. It never gates a plan: no assignment, rating or catalog entry is required.
   */
  treeId: string | null;
  /** Target stage: one of the existing self-assessment levels. A goal, not an observed level. */
  targetStage: SelfAssessedLevel;
  priority: RoadmapPriority;
  archived: boolean;
  milestones: PlanMilestone[];
  createdAt: Date;
  updatedAt: Date;
}

/** Plan document id shape: a server-issued random UUID. Independent of any competence-area id. */
const PLAN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isWellFormedPlanId(value: unknown): value is string {
  return typeof value === "string" && PLAN_ID_PATTERN.test(value);
}

/** Normalises a plan title: trimmed, non-empty, within the maximum length. `null` when invalid. */
export function normalizePlanTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > PLAN_TITLE_MAX_LENGTH) return null;
  return trimmed;
}

export function isMilestoneStatus(value: unknown): value is MilestoneStatus {
  return typeof value === "string" && (MILESTONE_STATUSES as readonly string[]).includes(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

const MILESTONE_KEYS = ["id", "title", "targetDate", "status"] as const;

export function isValidMilestone(value: unknown): value is PlanMilestone {
  if (!isPlainObject(value)) return false;
  if (Object.keys(value).length !== MILESTONE_KEYS.length || !MILESTONE_KEYS.every((key) => Object.hasOwn(value, key))) {
    return false;
  }
  const { id, title, targetDate, status } = value;
  return (
    typeof id === "string" &&
    id.length > 0 &&
    typeof title === "string" &&
    title.trim().length > 0 &&
    title.length <= MILESTONE_TITLE_MAX_LENGTH &&
    (targetDate === null || isValidPlanDate(targetDate)) &&
    isMilestoneStatus(status)
  );
}

const PLAN_KEYS = ["teamId", "title", "treeId", "targetStage", "priority", "archived", "milestones", "createdAt", "updatedAt"] as const;

/**
 * Fail-closed validation of a stored plan. Timestamps must already be `Date`. Extra or missing keys, a malformed identity,
 * a document id that is not a plan UUID, an empty title, a malformed optional catalog label, an unknown level or priority,
 * or an invalid milestone are all invalid. Never throws and never coerces a bad value to a default.
 */
export function parseStoredCompetencePlan(data: unknown, context: { docId: string }): CompetencePlan | null {
  try {
    if (!isPlainObject(data)) return null;
    if (Object.keys(data).length !== PLAN_KEYS.length || !PLAN_KEYS.every((key) => Object.hasOwn(data, key))) return null;
    const { teamId, title, treeId, targetStage, priority, archived, milestones, createdAt, updatedAt } = data;
    if (typeof teamId !== "string" || teamId.length === 0) return null;
    if (!isWellFormedPlanId(context.docId)) return null;
    if (typeof title !== "string" || normalizePlanTitle(title) !== title) return null;
    if (treeId !== null && !isWellFormedTreeId(treeId)) return null;
    if (!isSelfAssessedLevel(targetStage) || !isRoadmapPriority(priority)) return null;
    if (typeof archived !== "boolean") return null;
    if (!Array.isArray(milestones) || milestones.length > PLAN_MILESTONES_MAX) return null;
    if (!milestones.every(isValidMilestone)) return null;
    const ids = new Set(milestones.map((m) => m.id));
    if (ids.size !== milestones.length) return null;
    if (!isValidDate(createdAt) || !isValidDate(updatedAt)) return null;
    return {
      teamId,
      title,
      treeId,
      targetStage,
      priority,
      archived,
      milestones: milestones.map((m) => ({ ...m })),
      createdAt,
      updatedAt,
    };
  } catch {
    return null;
  }
}

export interface PlanProgress {
  completed: number;
  total: number;
}

/** Plan-step completion only: the count of completed milestones out of the total. No skill-level meaning. */
export function planProgress(milestones: readonly PlanMilestone[]): PlanProgress {
  return {
    completed: milestones.filter((m) => m.status === "completed").length,
    total: milestones.length,
  };
}

/**
 * Width of the completed fill as a percent of a bar's track: completed / total, exact (no rounding). Zero when there are
 * no milestones, so an empty plan never reads as complete. Timeline length is never an input.
 */
export function progressFillPercent(progress: PlanProgress): number {
  if (progress.total <= 0) return 0;
  return Math.min(100, Math.max(0, (progress.completed / progress.total) * 100));
}

export interface MilestoneInput {
  /** Present for an existing milestone; absent for a new one. */
  id?: string;
  title: string;
  targetDate: string | null;
  status: MilestoneStatus;
}

export interface PlanInput {
  title: string;
  targetStage: SelfAssessedLevel;
  priority: RoadmapPriority;
  archived: boolean;
  milestones: MilestoneInput[];
}

export type PlanInputIssue =
  | "title_invalid"
  | "target_stage_invalid"
  | "priority_invalid"
  | "archived_invalid"
  | "milestones_invalid"
  | "milestone_title_invalid"
  | "milestone_date_invalid"
  | "milestone_status_invalid"
  | "milestone_id_invalid";

export type PlanInputResult = { ok: true; value: PlanInput } | { ok: false; issues: PlanInputIssue[] };

const PLAN_INPUT_KEYS = ["title", "targetStage", "priority", "archived", "milestones"] as const;
const MILESTONE_INPUT_KEYS = ["id", "title", "targetDate", "status"] as const;

/**
 * Validates the whole plan body. The body is a full replacement of the plan's editable fields, so unknown keys are
 * refused rather than ignored. Milestone ids are optional; when present they must be a server-issued id shape.
 */
export function validatePlanInput(body: unknown): PlanInputResult {
  if (!isPlainObject(body) || Object.keys(body).some((key) => !(PLAN_INPUT_KEYS as readonly string[]).includes(key))) {
    return { ok: false, issues: ["milestones_invalid"] };
  }
  const issues: PlanInputIssue[] = [];
  const { title, targetStage, priority, archived, milestones } = body;

  const planTitle = normalizePlanTitle(title);
  if (planTitle === null) issues.push("title_invalid");
  if (!isSelfAssessedLevel(targetStage)) issues.push("target_stage_invalid");
  if (!isRoadmapPriority(priority)) issues.push("priority_invalid");
  if (typeof archived !== "boolean") issues.push("archived_invalid");

  const parsedMilestones: MilestoneInput[] = [];
  if (!Array.isArray(milestones) || milestones.length > PLAN_MILESTONES_MAX) {
    issues.push("milestones_invalid");
  } else {
    for (const raw of milestones) {
      const milestone = parseMilestoneInput(raw, issues);
      if (milestone !== null) parsedMilestones.push(milestone);
    }
    const ids = parsedMilestones.map((m) => m.id).filter((id): id is string => id !== undefined);
    if (new Set(ids).size !== ids.length) issues.push("milestone_id_invalid");
  }

  if (issues.length > 0) return { ok: false, issues: [...new Set(issues)] };
  return {
    ok: true,
    value: {
      title: planTitle as string,
      targetStage: targetStage as SelfAssessedLevel,
      priority: priority as RoadmapPriority,
      archived: archived as boolean,
      milestones: parsedMilestones,
    },
  };
}

function parseMilestoneInput(raw: unknown, issues: PlanInputIssue[]): MilestoneInput | null {
  if (!isPlainObject(raw) || Object.keys(raw).some((key) => !(MILESTONE_INPUT_KEYS as readonly string[]).includes(key))) {
    issues.push("milestones_invalid");
    return null;
  }
  let ok = true;
  const { id, title, targetDate, status } = raw;
  if (id !== undefined && (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id))) {
    issues.push("milestone_id_invalid");
    ok = false;
  }
  const trimmed = typeof title === "string" ? title.trim() : "";
  if (trimmed.length === 0 || trimmed.length > MILESTONE_TITLE_MAX_LENGTH) {
    issues.push("milestone_title_invalid");
    ok = false;
  }
  if (targetDate !== null && !isValidPlanDate(targetDate)) {
    issues.push("milestone_date_invalid");
    ok = false;
  }
  if (!isMilestoneStatus(status)) {
    issues.push("milestone_status_invalid");
    ok = false;
  }
  if (!ok) return null;
  return {
    ...(typeof id === "string" ? { id } : {}),
    title: trimmed,
    targetDate: targetDate as string | null,
    status: status as MilestoneStatus,
  };
}

/**
 * Builds the persisted milestone list. Existing ids are kept; a milestone without an id gets a new one from `newId`. An id
 * that does not belong to the stored plan is refused, so a client cannot attach invented identifiers.
 *
 * `newId` is required: this module is client-reachable and must not import Node-only modules such as `node:crypto`. The
 * server caller supplies the generator.
 */
export function resolveMilestones(
  input: readonly MilestoneInput[],
  existing: readonly PlanMilestone[],
  newId: () => string,
): { ok: true; milestones: PlanMilestone[] } | { ok: false } {
  const known = new Set(existing.map((m) => m.id));
  const milestones: PlanMilestone[] = [];
  for (const item of input) {
    if (item.id !== undefined && !known.has(item.id)) return { ok: false };
    milestones.push({
      id: item.id ?? newId(),
      title: item.title,
      targetDate: item.targetDate,
      status: item.status,
    });
  }
  return { ok: true, milestones };
}

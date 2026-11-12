import { isRoadmapPriority, ROADMAP_PRIORITIES, type RoadmapPriority } from "../../roadmap/domain/roadmap-item";
import { isValidPlanDate, planningToday } from "../../roadmap/domain/roadmap-dates";

/**
 * Team project domain (docs/archive/features/team-experience-redesign SPEC — BR-6, BR-7, BR-9).
 *
 * Projects are delivery items, separate from competence-stage roadmap records
 * (AD-1, BR-14). Pure: no Firestore, no clock reads, no I/O.
 */

/** Stored lifecycle. `Pågår` is never stored; it is derived by `resolveEffectiveProjectStatus`. */
export const PROJECT_LIFECYCLE_STATUSES = ["planned", "completed"] as const;
export type ProjectLifecycleStatus = (typeof PROJECT_LIFECYCLE_STATUSES)[number];

/** Displayed status: `active` (`Pågår`) is derived from the start date for non-terminal projects. */
export const PROJECT_EFFECTIVE_STATUSES = ["planned", "active", "completed"] as const;
export type ProjectEffectiveStatus = (typeof PROJECT_EFFECTIVE_STATUSES)[number];

export const PROJECT_PRIORITIES = ROADMAP_PRIORITIES;
export type ProjectPriority = RoadmapPriority;

/** Upper bound for the title. A repository-level choice, not a product requirement; keep in sync with API validation. */
export const PROJECT_TITLE_MAX_LENGTH = 200;

/**
 * Persisted/domain shape of a team project. Identifiers are opaque strings; the
 * product link is optional and must belong to the same team (enforced by the
 * server gateway in TASK-003 through `isSameTeamProductLink`).
 */
export interface TeamProject {
  projectId: string;
  teamId: string;
  title: string;
  productId?: string;
  /** Calendar date, `YYYY-MM-DD`. Required. */
  startDate: string;
  /** Calendar date, `YYYY-MM-DD`. Required, not before `startDate`. */
  endDate: string;
  lifecycleStatus: ProjectLifecycleStatus;
  priority: ProjectPriority;
  archived: boolean;
}

export type ProjectValidationIssue =
  | "title_required"
  | "title_too_long"
  | "start_date_invalid"
  | "end_date_invalid"
  | "end_before_start"
  | "lifecycle_status_invalid"
  | "priority_invalid";

export type ProjectValidationResult =
  | { ok: true; value: ProjectFields }
  | { ok: false; issues: ProjectValidationIssue[] };

/** Editable fields a caller may submit. Validated before use; never trusted as typed. */
export interface ProjectFields {
  title: string;
  productId?: string;
  startDate: string;
  endDate: string;
  lifecycleStatus: ProjectLifecycleStatus;
  priority: ProjectPriority;
}

export function isProjectLifecycleStatus(value: unknown): value is ProjectLifecycleStatus {
  return typeof value === "string" && (PROJECT_LIFECYCLE_STATUSES as readonly string[]).includes(value);
}

/**
 * Validates untrusted project input. Returns trimmed, typed fields or every
 * issue found (not just the first), so API responses can report them all.
 */
export function validateProjectFields(input: unknown): ProjectValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, issues: ["title_required", "start_date_invalid", "end_date_invalid", "lifecycle_status_invalid", "priority_invalid"] };
  }
  const r = input as Record<string, unknown>;
  const issues: ProjectValidationIssue[] = [];

  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (title.length === 0) issues.push("title_required");
  else if (title.length > PROJECT_TITLE_MAX_LENGTH) issues.push("title_too_long");

  const startValid = isValidPlanDate(r.startDate);
  const endValid = isValidPlanDate(r.endDate);
  if (!startValid) issues.push("start_date_invalid");
  if (!endValid) issues.push("end_date_invalid");
  if (startValid && endValid && (r.startDate as string) > (r.endDate as string)) issues.push("end_before_start");

  if (!isProjectLifecycleStatus(r.lifecycleStatus)) issues.push("lifecycle_status_invalid");
  if (!isRoadmapPriority(r.priority)) issues.push("priority_invalid");

  if (issues.length > 0) return { ok: false, issues };

  const productId = typeof r.productId === "string" && r.productId.length > 0 ? r.productId : undefined;
  return {
    ok: true,
    value: {
      title,
      ...(productId ? { productId } : {}),
      startDate: r.startDate as string,
      endDate: r.endDate as string,
      lifecycleStatus: r.lifecycleStatus as ProjectLifecycleStatus,
      priority: r.priority as RoadmapPriority,
    },
  };
}

/**
 * Effective status (BR-9, roadmap semantics per SPEC §4.4):
 * - `completed` stays `completed` regardless of dates.
 * - Otherwise `active` (`Pågår`) when the start date is today or earlier, in the
 *   planning calendar (Europe/Oslo, via `planningToday`).
 * - Otherwise `planned`. A target/end date alone never implies completion.
 *
 * `today` is an injected `YYYY-MM-DD` so the result is deterministic in tests.
 */
export function resolveEffectiveProjectStatus(
  project: Pick<TeamProject, "lifecycleStatus" | "startDate">,
  today: string,
): ProjectEffectiveStatus {
  if (project.lifecycleStatus === "completed") return "completed";
  return project.startDate <= today ? "active" : "planned";
}

/** Convenience: resolve against the planning calendar date of an injected instant. */
export function resolveEffectiveProjectStatusAt(
  project: Pick<TeamProject, "lifecycleStatus" | "startDate">,
  now: Date,
): ProjectEffectiveStatus {
  return resolveEffectiveProjectStatus(project, planningToday(now));
}

/**
 * Parses a raw `teamProjects/{projectId}` document (timestamps already mapped
 * to `Date`). Fails closed: a wrong team, a document id mismatch, a malformed
 * field or an invalid date order yields `null`, which callers treat as an
 * explicit persistence error, never as a default value.
 */
export function parseStoredTeamProject(raw: unknown, projectId: string, teamId: string): TeamProject | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.teamId !== teamId || projectId.length === 0 || typeof r.archived !== "boolean") return null;
  // Product association is unsupported until an approved Product domain exists
  // (owner decision). No write path stores productId, so any non-null value is
  // an unvalidated reference and the record is treated as malformed.
  if (r.productId !== undefined && r.productId !== null) return null;
  const fields = validateProjectFields(r);
  if (!fields.ok) return null;
  // Stored titles were validated on write; a stored title that no longer passes validation is malformed.
  if (fields.value.title !== r.title) return null;
  return { projectId, teamId, ...fields.value, archived: r.archived };
}

/** Team ownership: a project is only ever read or written inside its own team. */
export function isProjectInTeam(project: Pick<TeamProject, "teamId">, teamId: string): boolean {
  return teamId.length > 0 && project.teamId === teamId;
}

/**
 * A product link is valid only when the product belongs to the same team. The
 * caller passes the product's stored team id, read server-side; this function
 * never trusts a client-supplied team.
 */
export function isSameTeamProductLink(productTeamId: string | null | undefined, teamId: string): boolean {
  return typeof productTeamId === "string" && productTeamId.length > 0 && productTeamId === teamId;
}

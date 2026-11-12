import { isMemberRef } from "../../teams/domain/member-ref";
import { isValidPlanDate } from "../../roadmap/domain/roadmap-dates";

/**
 * Project participation (docs/archive/features/team-experience-redesign SPEC — BR-8, BR-12, BR-13; TASKS TASK-004).
 *
 * A participation records that one team member is planned to work on one team project for a calendar interval.
 * It is planning data only: there is no utilization, capacity, productivity or performance field, and nothing here
 * computes one. Overlapping intervals are reported as an informational flag only. Pure: no Firestore, no clock reads.
 */

/** Upper bound for the optional, non-evaluative description. A repository choice; keep in sync with API validation. */
export const PARTICIPATION_NOTE_MAX_LENGTH = 500;

/** Persisted/domain shape. `memberRef` is an opaque planning selector, never authorization evidence. */
export interface TeamProjectParticipation {
  participationId: string;
  teamId: string;
  projectId: string;
  memberRef: string;
  /** Calendar date, `YYYY-MM-DD`. Required. */
  startDate: string;
  /** Calendar date, `YYYY-MM-DD`. Required, not before `startDate`. Inclusive. */
  endDate: string;
  note?: string;
  archived: boolean;
}

export type ParticipationValidationIssue =
  | "project_id_required"
  | "member_ref_invalid"
  | "start_date_invalid"
  | "end_date_invalid"
  | "end_before_start"
  | "note_too_long"
  | "note_invalid";

export type ParticipationValidationResult =
  | { ok: true; value: ParticipationFields }
  | { ok: false; issues: ParticipationValidationIssue[] };

/** Editable fields a caller may submit. Validated before use; never trusted as typed. */
export interface ParticipationFields {
  projectId: string;
  memberRef: string;
  startDate: string;
  endDate: string;
  note?: string;
}

/**
 * Validates untrusted participation input and returns every issue at once. Unknown keys are rejected by the
 * envelope check in the server gateway, not here, so this function only sees allow-listed fields.
 */
export function validateParticipationFields(input: unknown): ParticipationValidationResult {
  const allInvalid: ParticipationValidationIssue[] = ["project_id_required", "member_ref_invalid", "start_date_invalid", "end_date_invalid"];
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, issues: allInvalid };
  const r = input as Record<string, unknown>;
  const issues: ParticipationValidationIssue[] = [];

  const projectId = typeof r.projectId === "string" ? r.projectId.trim() : "";
  if (projectId.length === 0) issues.push("project_id_required");
  if (!isMemberRef(r.memberRef)) issues.push("member_ref_invalid");

  const startValid = isValidPlanDate(r.startDate);
  const endValid = isValidPlanDate(r.endDate);
  if (!startValid) issues.push("start_date_invalid");
  if (!endValid) issues.push("end_date_invalid");
  if (startValid && endValid && (r.startDate as string) > (r.endDate as string)) issues.push("end_before_start");

  let note: string | undefined;
  if (r.note !== undefined && r.note !== null) {
    if (typeof r.note !== "string") issues.push("note_invalid");
    else {
      const trimmed = r.note.trim();
      if (trimmed.length > PARTICIPATION_NOTE_MAX_LENGTH) issues.push("note_too_long");
      else if (trimmed.length > 0) note = trimmed;
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      projectId,
      memberRef: r.memberRef as string,
      startDate: r.startDate as string,
      endDate: r.endDate as string,
      ...(note !== undefined ? { note } : {}),
    },
  };
}

/** Inclusive calendar-interval overlap. Dates are `YYYY-MM-DD`, so lexical order equals calendar order. */
export function participationIntervalsOverlap(
  a: Pick<ParticipationFields, "startDate" | "endDate">,
  b: Pick<ParticipationFields, "startDate" | "endDate">,
): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

/**
 * Informational overlap flag (BR-8): true when `candidate` overlaps another active participation of the same member.
 * It never blocks a write and never produces a capacity or utilization value.
 */
export function hasOverlappingParticipation(
  candidate: Pick<ParticipationFields, "memberRef" | "startDate" | "endDate">,
  existing: ReadonlyArray<Pick<ParticipationFields, "memberRef" | "startDate" | "endDate">>,
): boolean {
  return existing.some((other) => other.memberRef === candidate.memberRef && participationIntervalsOverlap(candidate, other));
}

/**
 * Parses a raw stored participation document. Fails closed: a wrong team, a missing or mismatched id, an invalid
 * member reference, invalid or reversed dates, or a malformed note yields `null`. Callers report a read failure;
 * they never coerce the record to a default.
 */
export function parseStoredParticipation(raw: unknown, participationId: string, teamId: string): TeamProjectParticipation | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.teamId !== teamId || participationId.length === 0 || typeof r.archived !== "boolean") return null;
  const fields = validateParticipationFields(r);
  if (!fields.ok) return null;
  // Stored values must already be in canonical form; a value that only validates after trimming is malformed.
  if (fields.value.projectId !== r.projectId) return null;
  // A stored note is canonical only when it equals its trimmed form; a blank note is never written and is malformed.
  if (typeof r.note === "string" && r.note !== fields.value.note) return null;
  return {
    participationId,
    teamId,
    ...fields.value,
    archived: r.archived,
  };
}

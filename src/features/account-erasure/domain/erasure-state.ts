/**
 * Erasure status, step, and error vocabularies, and the forward-only transition guard (SPEC "Erasure state machine").
 *
 * Pure: no dependencies. Nothing here may carry an identifier, content, or free text (AE-SI-5, AE-SI-6). The error
 * codes are a closed set and must never be extended with message text.
 */

/** Persisted status of `accountErasures/{uid}`. */
export const ERASURE_STATUSES = ["in_progress", "auth_deleted", "completed"] as const;
export type ErasureStatus = (typeof ERASURE_STATUSES)[number];

/** Steps in the order the SPEC requires. A record's step only moves forward. */
export const ERASURE_STEPS = [
  "forum",
  "memberships",
  "conversations_owned",
  "participant_bindings",
  "locators",
  "personal_data",
  "survey_participations",
  "actor_audit",
  "verify_data",
  "auth_delete",
  "final_sweep",
] as const;
export type ErasureStep = (typeof ERASURE_STEPS)[number];

/** Errors recorded on the erasure record (`errorCode`). Closed set (BR-15). */
export const ERASURE_RECORD_ERROR_CODES = [
  "payload_unreadable",
  "store_unavailable",
  "auth_unavailable",
  "verification_failed",
  "unexpected",
] as const;
export type ErasureRecordErrorCode = (typeof ERASURE_RECORD_ERROR_CODES)[number];

/** Errors returned by the API. Closed set. */
/**
 * Public API error codes (closed set). `erasure_unavailable` is the HTTP 503 for a resumable operational failure or a
 * production-not-ready refusal (TASK-013, SPEC "Start/resume contract"). It never exposes the persisted record code.
 */
export const ERASURE_API_ERROR_CODES = [
  "erasure_in_progress",
  "recent_auth_required",
  "confirmation_mismatch",
  "erasure_unavailable",
  "last_superadmin",
] as const;
export type ErasureApiErrorCode = (typeof ERASURE_API_ERROR_CODES)[number];

/**
 * Status transitions the SPEC allows:
 * `in_progress -> in_progress` (step advance), `in_progress -> auth_deleted` (after Auth deletion),
 * `auth_deleted -> completed` (after final sweep). Every other move is refused, including any move back toward
 * `in_progress` and a jump from `in_progress` straight to `completed`.
 */
const ALLOWED_STATUS_TRANSITIONS: Readonly<Record<ErasureStatus, readonly ErasureStatus[]>> = {
  in_progress: ["in_progress", "auth_deleted"],
  auth_deleted: ["auth_deleted", "completed"],
  completed: ["completed"],
};

export function isAllowedStatusTransition(from: ErasureStatus, to: ErasureStatus): boolean {
  return ALLOWED_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * A step may stay where it is or move to the immediately next step (SPEC "Transitions": `in_progress/<step> ->
 * in_progress/<next step>` after the step's verification returns zero). It never moves backward and never skips a step,
 * so a later step's work cannot run before an earlier step's verification.
 */
export function isAllowedStepTransition(from: ErasureStep, to: ErasureStep): boolean {
  const delta = ERASURE_STEPS.indexOf(to) - ERASURE_STEPS.indexOf(from);
  return delta === 0 || delta === 1;
}

export function isErasureStatus(value: unknown): value is ErasureStatus {
  return typeof value === "string" && (ERASURE_STATUSES as readonly string[]).includes(value);
}

export function isErasureStep(value: unknown): value is ErasureStep {
  return typeof value === "string" && (ERASURE_STEPS as readonly string[]).includes(value);
}

export function isErasureRecordErrorCode(value: unknown): value is ErasureRecordErrorCode {
  return typeof value === "string" && (ERASURE_RECORD_ERROR_CODES as readonly string[]).includes(value);
}

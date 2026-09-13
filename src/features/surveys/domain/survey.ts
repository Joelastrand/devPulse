export type SurveyAccessMode = "public" | "authenticated";

const SURVEY_ACCESS_MODES: readonly SurveyAccessMode[] = ["public", "authenticated"];

/**
 * Per-survey result-publication threshold (docs/features/managed-surveys/
 * SPEC.md — "Per-survey result threshold"). Replaces the single, global
 * `MIN_RESPONSE_THRESHOLD` for the publication decision: every survey
 * persists its own `minimumResponses`, validated and immutable at
 * creation. `DEFAULT_MINIMUM_RESPONSES` is only ever a UI/form default —
 * it is never used as a fallback when reading persisted data, and a
 * missing/invalid `minimumResponses` on a persisted survey fails closed
 * (`isValidSurvey` rejects it) rather than assuming this value.
 */
export const DEFAULT_MINIMUM_RESPONSES = 5;
export const MINIMUM_RESPONSES_MIN = 3;
export const MINIMUM_RESPONSES_MAX = 20;

/**
 * Runtime-validates a raw value as a survey's `minimumResponses` — an
 * integer in `[MINIMUM_RESPONSES_MIN, MINIMUM_RESPONSES_MAX]`. Fail-closed:
 * returns `false` (never throws) for a missing value, `null`, a string
 * (including a numeric-looking one like `"5"`), `NaN`, `Infinity`, a
 * decimal, or any integer outside the allowed range. There is no fallback
 * path anywhere that treats an invalid value as `DEFAULT_MINIMUM_RESPONSES`
 * — every caller (creation validation, persisted-survey validation) must
 * fail closed on an invalid value instead.
 */
export function isValidMinimumResponses(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MINIMUM_RESPONSES_MIN &&
    value <= MINIMUM_RESPONSES_MAX
  );
}

/**
 * Runtime-validates a raw value as a `SurveyAccessMode` before it drives any
 * authorization/rendering decision — never trusted via an unchecked cast,
 * never inferred from route/auth state (docs/features/managed-surveys/
 * SPEC.md — "Survey access modes"). Fail-closed: returns `false` (never
 * throws) for `undefined`, any other string, or a non-string value.
 */
export function isValidSurveyAccessMode(value: unknown): value is SurveyAccessMode {
  return (
    typeof value === "string" &&
    (SURVEY_ACCESS_MODES as readonly string[]).includes(value)
  );
}

/**
 * A survey's derived answerability state — never a separately stored
 * status field (BR-9). Always recomputed from `openedAt`/`closedAt`/
 * `endAt` via `effectiveLifecycle`.
 */
export type SurveyLifecycle = "scheduled" | "open" | "closed";

/**
 * The canonical, persisted `Survey` domain shape (docs/features/
 * managed-surveys/SPEC.md — "Data model"). `surveyId` is a stable,
 * opaque, server-generated identifier (a Firestore auto-generated document
 * ID) — never derived from `title`/`teamId`, never client-supplied.
 *
 * This is the one place this shape is declared; later tasks (persistence,
 * server operations, UI) import it rather than inlining their own
 * object-shape annotations for "a survey document."
 */
export interface Survey {
  surveyId: string;
  teamId: string;
  title?: string;
  accessMode: SurveyAccessMode;
  minimumResponses: number;
  startAt?: Date;
  endAt?: Date;
  openedAt?: Date;
  closedAt?: Date;
  archivedAt?: Date;
  createdAt: Date;
  createdBy: string;
}

/**
 * The narrow slice of `Survey` that `effectiveLifecycle` depends on — a
 * function should only depend on the fields it actually uses
 * (`.claude/rules/typescript.md`). Deliberately excludes `startAt`: a
 * survey's derived lifecycle never depends on it (see
 * `effectiveLifecycle`'s doc comment).
 */
export interface SurveyLifecycleFields {
  openedAt?: Date;
  closedAt?: Date;
  endAt?: Date;
}

/**
 * The single authoritative derivation of a survey's answerability state,
 * computed identically everywhere it's used — submission enforcement,
 * admin UI, team UI (BR-9). `now` is always supplied by the caller (the
 * server's own clock at the authoritative operation, or an explicit
 * instant in tests) — this function never reads the system clock itself.
 *
 * - `closed` if `closedAt` is set, or if `endAt` is set and has been
 *   reached or passed (`now >= endAt`) — this is `endAt`'s fully
 *   automatic/live enforcement (BR-8): no background job persists this,
 *   it is recomputed on every call.
 * - `open` else if `openedAt` is set.
 * - `scheduled` otherwise.
 *
 * `startAt` is never involved in this derivation, by design (docs/
 * features/managed-surveys/SPEC.md — "Survey lifecycle" →
 * "Why `status=open` with a future `startAt` is not a contradiction"):
 * an explicitly opened survey is answerable regardless of its own planned
 * `startAt`. `SurveyLifecycleFields` excludes `startAt` entirely so it
 * cannot leak into this decision even by accident.
 */
export function effectiveLifecycle(
  survey: SurveyLifecycleFields,
  now: Date,
): SurveyLifecycle {
  if (survey.closedAt !== undefined) {
    return "closed";
  }

  if (survey.endAt !== undefined && now.getTime() >= survey.endAt.getTime()) {
    return "closed";
  }

  if (survey.openedAt !== undefined) {
    return "open";
  }

  return "scheduled";
}

/**
 * Fail-closed runtime validator for a candidate `Survey` object — the
 * guard every later Firestore-reading task must go through before
 * treating raw document data as a `Survey`, instead of an unchecked cast
 * from `DocumentData` (`.claude/rules/typescript.md`). Callers are
 * expected to have already mapped a raw Firestore document into this
 * candidate shape (document ID → `surveyId`, `Timestamp` fields →
 * `Date`, exactly as this codebase's existing Firestore-read call sites
 * already do) — this module has no Firestore/I/O dependency of its own.
 *
 * Returns `false` (never throws) for a missing/non-object candidate, a
 * `surveyId` that doesn't match `expected.surveyId`, a malformed/empty
 * `teamId` or `createdBy`, an invalid `accessMode`, a non-string `title`
 * (when present), a missing/invalid `createdAt`, a missing or invalid
 * `minimumResponses` (per `isValidMinimumResponses` — never defaulted to
 * `DEFAULT_MINIMUM_RESPONSES` here or anywhere else), or any lifecycle
 * timestamp (`startAt`/`endAt`/`openedAt`/`closedAt`/`archivedAt`) that is
 * present but not a valid `Date`.
 */
export function isValidSurvey(
  data: unknown,
  expected: { surveyId: string },
): data is Survey {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const record = data as Record<string, unknown>;

  return (
    record.surveyId === expected.surveyId &&
    isNonEmptyString(record.teamId) &&
    (record.title === undefined || typeof record.title === "string") &&
    isValidSurveyAccessMode(record.accessMode) &&
    isValidMinimumResponses(record.minimumResponses) &&
    isValidOptionalDate(record.startAt) &&
    isValidOptionalDate(record.endAt) &&
    isValidOptionalDate(record.openedAt) &&
    isValidOptionalDate(record.closedAt) &&
    isValidOptionalDate(record.archivedAt) &&
    isValidDate(record.createdAt) &&
    isNonEmptyString(record.createdBy)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isValidOptionalDate(value: unknown): value is Date | undefined {
  return value === undefined || isValidDate(value);
}

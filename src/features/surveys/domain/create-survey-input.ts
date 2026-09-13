import { isValidMinimumResponses, isValidSurveyAccessMode, type SurveyAccessMode } from "./survey";

/**
 * The validated shape of a survey-creation request body (docs/features/
 * managed-surveys/SPEC.md — "Admin creation/management flow", step 1).
 * `teamId` is deliberately not part of this shape: the target team is the
 * admin page's own route scope, resolved and re-authorized server-side by
 * the caller (TASK-002), never taken from this request-body input.
 *
 * `minimumResponses` is required, not optional — the admin creation UI
 * always sends a value (pre-filled with `DEFAULT_MINIMUM_RESPONSES`), but
 * this validator never assumes that default for a missing/invalid value:
 * client input is always untrusted, and the server independently validates
 * it (docs/features/managed-surveys/SPEC.md — "Per-survey result
 * threshold").
 */
export interface CreateSurveyInput {
  accessMode: SurveyAccessMode;
  minimumResponses: number;
  title?: string;
  startAt?: Date;
  endAt?: Date;
}

export type ValidateCreateSurveyInputResult =
  | { ok: true; data: CreateSurveyInput }
  | {
      ok: false;
      error:
        | "invalid_input"
        | "invalid_access_mode"
        | "invalid_minimum_responses"
        | "invalid_title"
        | "invalid_start_at"
        | "invalid_end_at"
        | "invalid_date_range";
    };

/**
 * Validates a raw, untrusted survey-creation request body. Does not
 * perform app-admin authorization or team-active checks — those are
 * TASK-002's server-side responsibility; this is shape/invariant
 * validation only.
 *
 * `accessMode` is required and must be one of `SurveyAccessMode`'s exact
 * values (never a default — docs/features/managed-surveys/SPEC.md —
 * "Survey access modes": "No pre-selected default"). `minimumResponses` is
 * likewise required and must satisfy `isValidMinimumResponses` (an integer
 * in `[3, 20]`) — a missing, non-integer, or out-of-range value is
 * rejected, never silently defaulted. `title`, `startAt`, and `endAt` are
 * optional; when `startAt`/`endAt` are both present, `endAt` must be
 * strictly after `startAt` — a zero-or-negative-length availability window
 * is rejected as a creation-time invariant.
 */
export function validateCreateSurveyInput(
  input: unknown,
): ValidateCreateSurveyInputResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "invalid_input" };
  }

  const { accessMode, minimumResponses, title, startAt, endAt } = input as Record<
    string,
    unknown
  >;

  if (!isValidSurveyAccessMode(accessMode)) {
    return { ok: false, error: "invalid_access_mode" };
  }

  if (!isValidMinimumResponses(minimumResponses)) {
    return { ok: false, error: "invalid_minimum_responses" };
  }

  if (title !== undefined && typeof title !== "string") {
    return { ok: false, error: "invalid_title" };
  }

  let parsedStartAt: Date | undefined;
  if (startAt !== undefined) {
    const parsed = toValidDate(startAt);
    if (parsed === null) {
      return { ok: false, error: "invalid_start_at" };
    }
    parsedStartAt = parsed;
  }

  let parsedEndAt: Date | undefined;
  if (endAt !== undefined) {
    const parsed = toValidDate(endAt);
    if (parsed === null) {
      return { ok: false, error: "invalid_end_at" };
    }
    parsedEndAt = parsed;
  }

  if (
    parsedStartAt !== undefined &&
    parsedEndAt !== undefined &&
    parsedEndAt.getTime() <= parsedStartAt.getTime()
  ) {
    return { ok: false, error: "invalid_date_range" };
  }

  return {
    ok: true,
    data: {
      accessMode,
      minimumResponses,
      ...(title !== undefined ? { title } : {}),
      ...(parsedStartAt !== undefined ? { startAt: parsedStartAt } : {}),
      ...(parsedEndAt !== undefined ? { endAt: parsedEndAt } : {}),
    },
  };
}

/** Accepts a `Date` instance or an ISO-8601-parseable string; rejects anything else. */
function toValidDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

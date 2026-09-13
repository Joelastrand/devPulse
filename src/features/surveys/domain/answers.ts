const ANSWER_COUNT = 3;
const MIN_ANSWER = 1;
const MAX_ANSWER = 5;

/** The fixed three-question, 1-5 scale answer set (unchanged from Phase 1). */
export type SurveyAnswers = [number, number, number];

export type ValidateSurveyAnswersResult =
  | { ok: true; data: SurveyAnswers }
  | { ok: false; error: "invalid_answers" };

/**
 * Validates a raw, untrusted answer payload for a survey submission.
 * Survey-scoped, not team-selection-scoped: unlike `pulse-survey`'s
 * `validateSubmission`, there is no `teamId` here — a submission's
 * `teamId` is always resolved server-side from the survey record itself
 * (BR-19), never accepted from the client.
 *
 * Same rule as `src/features/pulse-survey/domain/validation.ts`, not
 * weakened or extended: exactly 3 answers, each an integer in [1, 5].
 * Returns a generic failure on any invalid case, without indicating which
 * element failed.
 */
export function validateSurveyAnswers(input: unknown): ValidateSurveyAnswersResult {
  if (!Array.isArray(input) || input.length !== ANSWER_COUNT) {
    return { ok: false, error: "invalid_answers" };
  }

  if (!input.every(isValidAnswer)) {
    return { ok: false, error: "invalid_answers" };
  }

  return { ok: true, data: input as SurveyAnswers };
}

function isValidAnswer(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_ANSWER &&
    value <= MAX_ANSWER
  );
}

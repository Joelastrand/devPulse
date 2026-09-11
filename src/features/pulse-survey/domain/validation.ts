const ANSWER_COUNT = 3;
const MIN_ANSWER = 1;
const MAX_ANSWER = 5;

export interface ValidatedSubmission {
  answers: [number, number, number];
  /**
   * A structurally valid (non-empty string) team identifier — a Firestore
   * `teams` document ID as of TASK-006. Whether it is an actual, currently
   * `active` team is validated separately, server-side, against Firestore
   * (`submitPulseSurvey`) — this domain layer only validates shape.
   */
  teamId: string;
}

export type SubmissionValidationResult =
  | { ok: true; data: ValidatedSubmission }
  | { ok: false; error: "invalid_submission" };

const INVALID_RESULT: SubmissionValidationResult = {
  ok: false,
  error: "invalid_submission",
};

/**
 * Validates a raw, untrusted submission payload.
 *
 * Returns a generic failure on any invalid case (per BR-5) without
 * indicating which field failed, so callers must not branch on failure
 * reason in a way that leaks validation internals to the client.
 */
export function validateSubmission(input: unknown): SubmissionValidationResult {
  if (typeof input !== "object" || input === null) {
    return INVALID_RESULT;
  }

  const { answers, teamId } = input as Record<string, unknown>;

  if (!Array.isArray(answers) || answers.length !== ANSWER_COUNT) {
    return INVALID_RESULT;
  }

  if (!answers.every(isValidAnswer)) {
    return INVALID_RESULT;
  }

  if (!isValidTeamIdShape(teamId)) {
    return INVALID_RESULT;
  }

  return {
    ok: true,
    data: {
      answers: answers as [number, number, number],
      teamId,
    },
  };
}

function isValidTeamIdShape(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidAnswer(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_ANSWER &&
    value <= MAX_ANSWER
  );
}

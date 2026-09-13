import "server-only";
import { decrypt, type EncryptedPayload } from "../../../lib/encryption/encryption";

const ANSWER_COUNT = 3;
const MIN_ANSWER = 1;
const MAX_ANSWER = 5;

export interface DimensionMeans {
  flow: number;
  stress: number;
  fun: number;
}

/** The encrypted-record shape this module needs — a subset of the persisted Phase 1 record. */
export type CandidateResponseRecord = EncryptedPayload;

export type SurveyAggregateResult =
  | { surveyId: string; status: "insufficient" }
  | { surveyId: string; status: "published"; mean: DimensionMeans; count: number };

/**
 * Computes one survey instance's publishable aggregate from its candidate
 * `SurveyResponse` records, using that survey's own persisted
 * `minimumResponses` (docs/features/managed-surveys/SPEC.md — "Per-survey
 * result threshold"). Deliberately takes no default for `minimumResponses`
 * — the now-retired calendar-period aggregation fell back to a single
 * global threshold constant; every survey's own threshold is mandatory
 * here instead. The caller is expected to have already validated the
 * survey (TASK-001's `isValidSurvey`, which validates `minimumResponses`
 * itself) before calling this.
 *
 * There is no "not_available" outcome (the now-retired period-scoped
 * version had one for the still-open current period): the caller only
 * ever calls this for a survey it has already determined is `closed`
 * (TASK-011's aggregation server operation).
 *
 * As an optimization (not a behavior change), a survey whose raw candidate
 * count already falls below `minimumResponses` is never decrypted at all —
 * decrypting can only ever reduce the valid count further (a corrupted
 * record decodes to nothing), so the outcome is already determined.
 */
export function computeSurveyAggregate(
  surveyId: string,
  candidates: readonly CandidateResponseRecord[],
  minimumResponses: number,
): SurveyAggregateResult {
  if (candidates.length < minimumResponses) {
    return { surveyId, status: "insufficient" };
  }

  const validAnswers = candidates
    .map(decodeCandidate)
    .filter((answers): answers is [number, number, number] => answers !== null);

  if (validAnswers.length < minimumResponses) {
    return { surveyId, status: "insufficient" };
  }

  return {
    surveyId,
    status: "published",
    mean: computeMean(validAnswers),
    count: validAnswers.length,
  };
}

/**
 * Decrypts and schema-validates one candidate record, returning `null` on
 * any failure (bad key, tampered ciphertext, malformed JSON, or an
 * out-of-range/wrong-shaped answer set) so a single bad record degrades
 * gracefully rather than throwing. Never logs the failure or its cause —
 * decrypted content and decryption-failure detail must never reach logs
 * (`docs/SECURITY.md` invariant 14).
 */
function decodeCandidate(
  record: CandidateResponseRecord,
): [number, number, number] | null {
  try {
    const plaintext = decrypt(record);
    const parsed: unknown = JSON.parse(plaintext);
    return isValidAnswerTuple(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isValidAnswerTuple(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === ANSWER_COUNT &&
    value.every(
      (answer) =>
        typeof answer === "number" &&
        Number.isInteger(answer) &&
        answer >= MIN_ANSWER &&
        answer <= MAX_ANSWER,
    )
  );
}

function computeMean(answers: readonly [number, number, number][]): DimensionMeans {
  const totals = answers.reduce(
    (sum, [flow, stress, fun]) => ({
      flow: sum.flow + flow,
      stress: sum.stress + stress,
      fun: sum.fun + fun,
    }),
    { flow: 0, stress: 0, fun: 0 },
  );

  return {
    flow: totals.flow / answers.length,
    stress: totals.stress / answers.length,
    fun: totals.fun / answers.length,
  };
}

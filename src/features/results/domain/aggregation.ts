import "server-only";
import { decrypt, type EncryptedPayload } from "../../../lib/encryption/encryption";
import {
  getCurrentSurveyPeriod,
  isPeriodClosed,
} from "../../pulse-survey/domain/period";

/** The default, configurable minimum-response publication gate (SECURITY.md invariant 12). */
export const MIN_RESPONSE_THRESHOLD = 5;

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

export type PeriodAggregateResult =
  | { period: string; status: "not_available" }
  | { period: string; status: "insufficient" }
  | { period: string; status: "published"; mean: DimensionMeans; count: number };

export interface ComputePeriodAggregateDeps {
  now?: Date;
  threshold?: number;
}

/**
 * Computes one team/period's publishable aggregate from its candidate
 * `SurveyResponse` records.
 *
 * Enforces BR-6 (the open period is never eligible, regardless of the
 * candidates passed in) and BR-7 (threshold suppression withholds the count
 * for below-threshold periods, including zero) at this domain layer, as
 * defense in depth ahead of the API layer (TASK-004).
 */
export function computePeriodAggregate(
  period: string,
  candidates: readonly CandidateResponseRecord[],
  deps: ComputePeriodAggregateDeps = {},
): PeriodAggregateResult {
  const currentPeriod = getCurrentSurveyPeriod(deps.now);

  if (!isPeriodClosed(period, currentPeriod)) {
    return { period, status: "not_available" };
  }

  const threshold = deps.threshold ?? MIN_RESPONSE_THRESHOLD;
  const validAnswers = candidates
    .map(decodeCandidate)
    .filter((answers): answers is [number, number, number] => answers !== null);

  if (validAnswers.length < threshold) {
    return { period, status: "insufficient" };
  }

  return {
    period,
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

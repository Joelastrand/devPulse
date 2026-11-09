import { isSelfAssessedLevel, type SelfAssessedLevel } from "../../skill-profiles/domain/self-assessed-level";

/**
 * Pure numeric team level for one competence area (Amendment A, invariant 35 aggregate rule, on-demand design).
 *
 * `level = floor((2·sum + n) / (2·n))`: the arithmetic mean of the eligible contributors' valid levels, rounded to the
 * nearest integer with an exact half rounding up, in integer arithmetic only. For every valid input the result lies in
 * 1–4. The function never returns a sum, count, minimum, maximum or identity; its only outputs are a level or
 * `insufficient_data`.
 */

/** Invariant 34: the threshold may never be lowered below three. */
export const TEAM_LEVEL_MIN_CONTRIBUTORS_FLOOR = 3;

/**
 * Owner-approved threshold for the automatic numeric team profile (2026-11-07 and 2026-11-08 decisions): three eligible
 * contributors per competence area, with no additional team-size floor. Small-team inference is an accepted product risk and
 * is not described as anonymous. The categorical coverage view keeps its own k (`SKILL_COVERAGE_MIN_CONTRIBUTORS`).
 */
export const AUTOMATIC_TEAM_LEVEL_MIN_CONTRIBUTORS = TEAM_LEVEL_MIN_CONTRIBUTORS_FLOOR;

export type TeamLevelResult =
  | { readonly state: "value"; readonly level: SelfAssessedLevel }
  | { readonly state: "insufficient_data" };

/**
 * @param levels One valid personal level (1–4) per eligible contributor for one area. A missing or unassessed
 *   contributor is absent from the array, never a zero. Malformed input throws; it is never coerced.
 * @param minContributors The threshold `k`. Must be an integer of at least three.
 */
export function deriveTeamLevel(levels: readonly unknown[], minContributors: number): TeamLevelResult {
  if (!Number.isInteger(minContributors) || minContributors < TEAM_LEVEL_MIN_CONTRIBUTORS_FLOOR) {
    throw new TypeError("invalid minContributors");
  }
  if (!Array.isArray(levels) || !levels.every(isSelfAssessedLevel)) throw new TypeError("invalid levels");

  const n = levels.length;
  if (n < minContributors) return { state: "insufficient_data" };

  const sum = levels.reduce((total, level) => total + level, 0);
  const level = Math.floor((2 * sum + n) / (2 * n));
  if (!isSelfAssessedLevel(level)) throw new TypeError("aggregate out of range");
  return { state: "value", level };
}

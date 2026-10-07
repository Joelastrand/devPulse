import { isSelfAssessedLevel } from "../../skill-profiles/domain/self-assessed-level";
import { SKILL_COVERAGE_MIN_CONTRIBUTORS } from "./skill-coverage-policy";
import { isRequiredCoverage, isRequiredLevel, type RequiredLevel } from "./skill-need";

/** Privacy outcomes of contributor-based derivation. Nothing else. */
export type CoverageState = "covered" | "gap" | "insufficient_data";

/** Non-personal integrity state; never produced by `deriveCoverageState`. */
export type NeedIntegrityState = "area_unavailable";

/** Row/presentation union, for DTO typing only. */
export type CoverageRowState = CoverageState | NeedIntegrityState;

export interface DeriveCoverageInput {
  requiredLevel: RequiredLevel;
  requiredCoverage: number;
  /**
   * One plain personal-scale level (1–4) per eligible contributor with a
   * valid level, for ONE skill tree. Unassessed or unreadable profiles are
   * absent, never level 0. No identity is accepted.
   */
  levels: readonly number[];
}

/**
 * Pure categorical derivation (SPEC BR-13/14). Fewer than k contributors ⇒
 * `insufficient_data`; otherwise `covered` iff enough levels reach the
 * required level, else `gap` (also when requiredCoverage exceeds the cohort).
 * Returns only the state — no counts. Malformed input throws; it is never
 * coerced.
 */
export function deriveCoverageState(input: DeriveCoverageInput): CoverageState {
  const { requiredLevel, requiredCoverage, levels } = input;
  if (!isRequiredLevel(requiredLevel)) throw new TypeError("invalid requiredLevel");
  if (!isRequiredCoverage(requiredCoverage)) throw new TypeError("invalid requiredCoverage");
  if (!Array.isArray(levels) || !levels.every(isSelfAssessedLevel)) throw new TypeError("invalid levels");

  if (levels.length < SKILL_COVERAGE_MIN_CONTRIBUTORS) return "insufficient_data";
  const qualifying = levels.filter((level) => level >= requiredLevel).length;
  return qualifying >= requiredCoverage ? "covered" : "gap";
}

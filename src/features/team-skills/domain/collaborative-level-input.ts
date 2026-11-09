/**
 * Pure validation of a teamadmin's manually entered collaborative team level for one competence area (Felles mode).
 *
 * Accepted: an integer 1–4 to set the value, or an explicit `null` to clear it. Anything else is rejected: a missing key,
 * a string, a fraction, 0, 5 and NaN never become a level. The input type carries no member data, so a collaborative
 * value cannot be derived from a private self-assessment here. Owned by team-skills because teamadmin authorization for
 * team-profile writes lives in this feature.
 */
import { isSelfAssessedLevel, type SelfAssessedLevel } from "../../skill-profiles/domain/self-assessed-level";

export type CollaborativeLevelInput =
  | { readonly ok: true; readonly level: SelfAssessedLevel | null }
  | { readonly ok: false };

export function parseCollaborativeLevelInput(value: unknown): CollaborativeLevelInput {
  if (value === null) return { ok: true, level: null };
  if (isSelfAssessedLevel(value)) return { ok: true, level: value };
  return { ok: false };
}

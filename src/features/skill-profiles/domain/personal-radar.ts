import type { SelfAssessedLevel } from "./self-assessed-level";
import type { OverviewAreaRow } from "./overview-model";

/**
 * Pure model for the personal competence radar on `/me/skills` (C1 BR-29 as amended 2026-11-10, owner-approved).
 *
 * Scope: only the signed-in person's own assessments and, optionally, the owner's selected target role. Team data never
 * enters this model. Axes are the person's assessed skills in canonical list order, so an unassessed skill is never
 * drawn as zero and the shape is never implied for a missing value.
 */

export const PERSONAL_RADAR_MIN_AXES = 3;
/** A radar stays readable up to roughly a dozen axes (C1 BR-29 reasoning). Beyond that the full list is the canonical view. */
export const PERSONAL_RADAR_MAX_AXES = 12;

export interface PersonalRadarPoint {
  readonly treeId: string;
  readonly label: string;
  readonly own: SelfAssessedLevel;
  /** The target role's expected level for this axis, or null when the target has none. */
  readonly target: SelfAssessedLevel | null;
}

export type PersonalRadarModel =
  | { readonly status: "too_few_assessed"; readonly assessedCount: number }
  | {
      readonly status: "ready";
      readonly points: readonly PersonalRadarPoint[];
      /** True only when every drawn axis has an expectation, so the target series is a complete polygon. */
      readonly showTarget: boolean;
      /** Assessed skills that do not fit on the chart. They stay in the list. */
      readonly omittedCount: number;
    };

export function buildPersonalRadarModel(
  areas: readonly OverviewAreaRow[],
  hasTarget: boolean,
): PersonalRadarModel {
  const assessed = areas.filter((area): area is OverviewAreaRow & { level: SelfAssessedLevel } => area.level !== null);
  if (assessed.length < PERSONAL_RADAR_MIN_AXES) {
    return { status: "too_few_assessed", assessedCount: assessed.length };
  }

  const drawn = assessed.slice(0, PERSONAL_RADAR_MAX_AXES);
  const points: PersonalRadarPoint[] = drawn.map((area) => ({
    treeId: area.treeId,
    label: area.name,
    own: area.level,
    target: area.expectedLevel,
  }));
  const showTarget = hasTarget && points.every((point) => point.target !== null);
  return {
    status: "ready",
    points: showTarget ? points : points.map((point) => ({ ...point, target: null })),
    showTarget,
    omittedCount: assessed.length - drawn.length,
  };
}

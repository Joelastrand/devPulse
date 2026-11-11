import type { SelfAssessedLevel } from "./self-assessed-level";
import type { OverviewAreaRow } from "./overview-model";

/**
 * Pure model for the personal radar on the Oversikt (individual-skill-self-assessment SPEC, dated pointer 2026-11-10).
 * It plots only the signed-in person's own assessed levels. Unassessed skills are never drawn as zero or as a gap, and
 * there is no target-role series: the radar is a view of the person's own levels only.
 */

/** At most this many axes are drawn; the rest are listed, and the caller says so. */
export const PERSONAL_RADAR_MAX_AXES = 12;
/** With fewer assessed skills than this there is no chart: a triangle or line would imply more than the data shows. */
export const PERSONAL_RADAR_MIN_AXES = 3;

export interface PersonalRadarPoint {
  readonly treeId: string;
  readonly label: string;
  readonly own: SelfAssessedLevel;
}

export type PersonalRadarModel =
  | {
      readonly status: "ready";
      readonly points: readonly PersonalRadarPoint[];
      /** Assessed skills beyond the axis cap. They are listed in the list view, not drawn. */
      readonly omittedByCap: number;
      /** Skills with no assessment. They are not drawn and are named as not drawn. */
      readonly unassessedCount: number;
    }
  | { readonly status: "too_few"; readonly assessedCount: number; readonly unassessedCount: number };

export function buildPersonalRadarModel(areas: readonly OverviewAreaRow[]): PersonalRadarModel {
  const assessed = areas.flatMap((area): PersonalRadarPoint[] =>
    area.level === null ? [] : [{ treeId: area.treeId, label: area.name, own: area.level }],
  );
  const unassessedCount = areas.length - assessed.length;
  if (assessed.length < PERSONAL_RADAR_MIN_AXES) {
    return { status: "too_few", assessedCount: assessed.length, unassessedCount };
  }
  const points = assessed.slice(0, PERSONAL_RADAR_MAX_AXES);
  return { status: "ready", points, omittedByCap: assessed.length - points.length, unassessedCount };
}

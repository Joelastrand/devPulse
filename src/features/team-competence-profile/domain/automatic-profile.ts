/**
 * Pure radar axes for the automatic (numeric) team profile. Maps the internal numeric team-level rows into the existing
 * `RadarAxisInput` contract. It is not connected to any route: the caller supplies the rows.
 *
 * Input rows carry only what the numeric operation already returns (area name, target, state and the integer team level).
 * They hold no contributor count, uid or individual assessment, and this module adds none. A missing, suppressed or
 * unavailable value stays `null`; it is never a zero.
 *
 * A malformed row is never turned into a missing value. Its axis is emitted with a value that `buildRadarModel` rejects
 * (an empty label or a non-integer level), so the whole profile reports `invalid`. Only the legitimate states map to
 * `null`: `insufficient_data` and `area_unavailable` for the level, and a `null` target for an unset target.
 */
import type { RadarAxisInput } from "./radar-model";

/** Norwegian label for an axis whose competence area can no longer be read (the numeric row has no name). */
export const UNAVAILABLE_AREA_LABEL = "Område ikke tilgjengelig";

/**
 * One numeric team-level row. Structurally compatible with the server's `TeamSkillLevelRow`; the discriminant decides
 * whether a level exists. `areaName` is `null` only for `area_unavailable`.
 */
export type AutomaticSkillLevelRow = {
  readonly treeId: string;
  readonly areaName: string | null;
  readonly targetLevel: number | null;
} & (
  | { readonly state: "value"; readonly level: number }
  | { readonly state: "insufficient_data" }
  | { readonly state: "area_unavailable" }
);

/**
 * A value no radar validator accepts: not an integer, so `buildRadarModel` reports `invalid`. Used for a malformed row,
 * so that it is rejected rather than read as a missing level.
 */
const REJECTED_LEVEL = Number.NaN;

/** An empty label is rejected by `buildRadarModel`, so a value row without a name cannot pass as a named area. */
const REJECTED_LABEL = "";

/**
 * Axes in the order the rows were given (the server already orders named areas by name, then unavailable areas by tree
 * id). A `value` row with a non-integer level, a `null` level, or a `null` name, and any row with an unknown state, is
 * emitted with a rejected value so the radar reports `invalid`. A target is passed through unchanged; `undefined` and
 * out-of-range targets are rejected by `buildRadarModel`.
 */
export function buildAutomaticAxes(rows: readonly AutomaticSkillLevelRow[]): RadarAxisInput[] {
  return rows.map(toAxisInput);
}

function toAxisInput(row: AutomaticSkillLevelRow): RadarAxisInput {
  const { treeId, targetLevel } = row;
  switch (row.state) {
    case "value":
      return {
        treeId,
        label: row.areaName ?? REJECTED_LABEL,
        teamLevel: typeof row.level === "number" ? row.level : REJECTED_LEVEL,
        targetLevel,
      };
    case "insufficient_data":
      return { treeId, label: row.areaName ?? REJECTED_LABEL, teamLevel: null, targetLevel };
    case "area_unavailable":
      return { treeId, label: UNAVAILABLE_AREA_LABEL, teamLevel: null, targetLevel };
    default:
      // Unknown state from outside the typed contract: rejected, never treated as unavailable.
      return { treeId, label: REJECTED_LABEL, teamLevel: REJECTED_LEVEL, targetLevel };
  }
}

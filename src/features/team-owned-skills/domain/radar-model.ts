/**
 * Pure model for the Kompetanseprofil radar (team-experience-redesign, D1 proposal §10e/§10f, Amendment A §A.4).
 *
 * Source-agnostic: the model takes team values and targets for each axis. It does not know whether the values came from
 * the automatic publication or from collaborative team assessments. It never returns a value for an unset axis, and it
 * never converts `null` to `0`. Invalid input fails closed to `invalid`; it is never coerced to a default.
 */
import { REQUIRED_LEVELS, type RequiredLevel } from "../../team-skills/domain/skill-need";

/** Owner decision (2026-11-07): a profile needs at least three axes; more than eight are shown as the table only. */
export const RADAR_MIN_AXES = 3;
export const RADAR_MAX_AXES = 8;

const TEAM_LEVEL_MIN = 1;
const TEAM_LEVEL_MAX = 4;
const LABEL_MAX_LENGTH = 120;

export type TeamLevel = 1 | 2 | 3 | 4;
export type TargetLevel = RequiredLevel;

export interface RadarAxisInput {
  readonly treeId: string;
  readonly label: string;
  readonly teamLevel: number | null;
  readonly targetLevel: number | null;
}

export interface RadarAxis {
  readonly treeId: string;
  readonly label: string;
  readonly teamLevel: TeamLevel | null;
  readonly targetLevel: TargetLevel | null;
}

/** One point of the chart. `null` means "not drawn"; it is never a zero. */
export interface RadarChartPoint {
  readonly axis: string;
  readonly team: TeamLevel | null;
  readonly target: TargetLevel | null;
}

export type RadarModel =
  | { readonly status: "ready"; readonly axes: readonly RadarAxis[]; readonly points: readonly RadarChartPoint[]; readonly setCount: number }
  | { readonly status: "too_few_axes"; readonly axes: readonly RadarAxis[] }
  | { readonly status: "too_many_axes"; readonly axes: readonly RadarAxis[] }
  | { readonly status: "empty"; readonly axes: readonly RadarAxis[] }
  | { readonly status: "invalid" };

function isTeamLevel(value: number | null): value is TeamLevel | null {
  return value === null || (Number.isInteger(value) && value >= TEAM_LEVEL_MIN && value <= TEAM_LEVEL_MAX);
}

function isTargetLevel(value: number | null): value is TargetLevel | null {
  return value === null || (REQUIRED_LEVELS as readonly number[]).includes(value);
}

function isValidLabel(label: string): boolean {
  const trimmed = label.trim();
  return trimmed.length > 0 && trimmed.length <= LABEL_MAX_LENGTH;
}

/** Validates every axis. Returns `null` when any axis is invalid, so the caller shows an error state. */
function validateAxes(input: readonly RadarAxisInput[]): RadarAxis[] | null {
  const seen = new Set<string>();
  const axes: RadarAxis[] = [];
  for (const axis of input) {
    if (typeof axis.treeId !== "string" || axis.treeId.length === 0 || seen.has(axis.treeId)) return null;
    if (typeof axis.label !== "string" || !isValidLabel(axis.label)) return null;
    if (!isTeamLevel(axis.teamLevel) || !isTargetLevel(axis.targetLevel)) return null;
    seen.add(axis.treeId);
    axes.push({ treeId: axis.treeId, label: axis.label.trim(), teamLevel: axis.teamLevel, targetLevel: axis.targetLevel });
  }
  return axes;
}

/**
 * Builds the radar model. Status precedence: invalid input, then too few axes, then too many axes, then empty (no
 * team value and no target on any axis), then ready.
 */
export function buildRadarModel(input: readonly RadarAxisInput[]): RadarModel {
  if (!Array.isArray(input)) return { status: "invalid" };
  const axes = validateAxes(input);
  if (axes === null) return { status: "invalid" };
  if (axes.length < RADAR_MIN_AXES) return { status: "too_few_axes", axes };
  if (axes.length > RADAR_MAX_AXES) return { status: "too_many_axes", axes };
  if (axes.every((axis) => axis.teamLevel === null && axis.targetLevel === null)) return { status: "empty", axes };

  const points: RadarChartPoint[] = axes.map((axis) => ({ axis: axis.label, team: axis.teamLevel, target: axis.targetLevel }));
  const setCount = axes.filter((axis) => axis.teamLevel !== null).length;
  return { status: "ready", axes, points, setCount };
}

/**
 * Pure composition of the collaborative (Felles) team profile, and the profile-mode vocabulary.
 *
 * Inputs are only the team's competence areas (`teamCompetenceAreas`, TASK-007, reused) and the team's needs' target
 * levels. No private member data type exists in this module, so the collaborative path cannot read member ratings
 * through it. Invalid stored values are passed through unchanged and reported by the radar model as `invalid`; they are
 * never replaced by a default.
 */
import type { RadarAxisInput } from "./radar-model";

export const PROFILE_MODES = ["automatic", "collaborative"] as const;
export type ProfileMode = (typeof PROFILE_MODES)[number];

/** Owner decision: automatic is the default. Used only when no stored mode exists. */
export const DEFAULT_PROFILE_MODE: ProfileMode = "automatic";

export function parseProfileMode(value: unknown): ProfileMode | null {
  return typeof value === "string" && (PROFILE_MODES as readonly string[]).includes(value) ? (value as ProfileMode) : null;
}

export interface CompetenceAreaForProfile {
  readonly treeId: string;
  readonly label: string;
  readonly status: "active" | "inactive" | "archived";
  /** Stored collaborative value; `null` when the team has not set one. Never defaulted. */
  readonly teamLevel: number | null;
}

export interface NeedTargetForProfile {
  readonly treeId: string;
  readonly requiredLevel: number;
}

/**
 * Axes for the collaborative radar: active areas only, in the order given. A target comes from the need for the same
 * tree, if one exists. Inactive and archived areas never appear, even when a need or a team value refers to them.
 */
export function buildCollaborativeAxes(
  areas: readonly CompetenceAreaForProfile[],
  needs: readonly NeedTargetForProfile[],
): RadarAxisInput[] {
  const targetByTree = new Map(needs.map((need) => [need.treeId, need.requiredLevel]));
  return areas
    .filter((area) => area.status === "active")
    .map((area) => ({
      treeId: area.treeId,
      label: area.label,
      teamLevel: area.teamLevel,
      targetLevel: targetByTree.get(area.treeId) ?? null,
    }));
}

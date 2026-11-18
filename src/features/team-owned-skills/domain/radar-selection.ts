/**
 * Which areas the Kompetanseprofil radar draws when more than `RADAR_MAX_AXES` areas are eligible. The selection affects
 * the visualization only: aggregation and the table always use every eligible area.
 */
import { RADAR_MAX_AXES } from "./radar-model";

/**
 * Returns the areas the radar should draw. `selected` is the user's saved choice (`null` when the user has not chosen).
 * A saved choice keeps its order, drops areas that are no longer eligible, and is capped at the maximum. Without a saved
 * choice, the first eligible areas in catalog order are used, so the default is deterministic.
 */
export function resolveRadarSelection(eligibleIds: readonly string[], selected: readonly string[] | null): string[] {
  if (selected === null) return eligibleIds.slice(0, RADAR_MAX_AXES);
  const eligible = new Set(eligibleIds);
  return selected.filter((id) => eligible.has(id)).slice(0, RADAR_MAX_AXES);
}

/** Adds or removes one area. A new area is refused when the radar is already full. */
export function toggleRadarSelection(current: readonly string[], skillId: string): string[] {
  if (current.includes(skillId)) return current.filter((id) => id !== skillId);
  if (current.length >= RADAR_MAX_AXES) return current.slice();
  return [...current, skillId];
}

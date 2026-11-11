/**
 * Status of one competence area against the team's need (the reference's "Oppfyller mål", "Nær mål", "Under utvikling",
 * "Ikke vurdert"). Pure. A missing level or a missing target is never treated as zero: the status is `unrated`.
 */
export type AreaStatus = "meets" | "near" | "under" | "unrated";

export const AREA_STATUSES: readonly AreaStatus[] = ["meets", "near", "under", "unrated"];

export function areaStatus(level: number | null, target: number | null): AreaStatus {
  if (level === null || target === null) return "unrated";
  if (level >= target) return "meets";
  if (level === target - 1) return "near";
  return "under";
}

export function countStatuses(statuses: readonly AreaStatus[]): Record<AreaStatus, number> {
  const counts: Record<AreaStatus, number> = { meets: 0, near: 0, under: 0, unrated: 0 };
  for (const status of statuses) counts[status] += 1;
  return counts;
}

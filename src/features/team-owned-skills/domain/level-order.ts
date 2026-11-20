/**
 * Ordering for the team's competency-level rows. It sorts only the values already on screen and never computes a level.
 * A missing level (not assessed, or suppressed by the privacy threshold) is never treated as zero: it sorts after every
 * calculated level in both directions, so a suppressed area cannot look like the lowest one.
 */

export type LevelOrder = "name" | "level-desc" | "level-asc";

export interface OrderableLevelRow {
  readonly skillId: string;
  readonly name: string;
  /** `null` when no level is available for this area in the active mode. */
  readonly level: number | null;
}

function byName(a: OrderableLevelRow, b: OrderableLevelRow): number {
  return a.name.localeCompare(b.name, "nb") || a.skillId.localeCompare(b.skillId);
}

/** Returns a new, stably ordered array. The input is never mutated. Ties break by name, then by id. */
export function sortLevelRows<T extends OrderableLevelRow>(rows: readonly T[], order: LevelOrder): T[] {
  return rows.slice().sort((a, b) => {
    if (order === "name") return byName(a, b);
    if (a.level === null && b.level === null) return byName(a, b);
    if (a.level === null) return 1;
    if (b.level === null) return -1;
    const difference = order === "level-desc" ? b.level - a.level : a.level - b.level;
    return difference !== 0 ? difference : byName(a, b);
  });
}

/**
 * The highest and lowest calculated level among the given rows, for the compact summary. Rows without a level are ignored
 * rather than counted as zero. Returns `null` when there are no calculated levels. Ties are reported as a count, not as a
 * single winner.
 */
export function levelExtremes<T extends OrderableLevelRow>(rows: readonly T[]): {
  highest: { name: string; level: number; tied: number };
  lowest: { name: string; level: number; tied: number };
} | null {
  const calculated = rows.filter((row): row is T & { level: number } => row.level !== null);
  if (calculated.length === 0) return null;
  const ordered = sortLevelRows(calculated, "level-desc");
  const top = ordered[0];
  const bottom = sortLevelRows(calculated, "level-asc")[0];
  if (!top || !bottom) return null;
  return {
    highest: { name: top.name, level: top.level, tied: calculated.filter((row) => row.level === top.level).length },
    lowest: { name: bottom.name, level: bottom.level, tied: calculated.filter((row) => row.level === bottom.level).length },
  };
}

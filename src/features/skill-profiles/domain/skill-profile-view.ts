import { SELF_ASSESSED_LEVELS, type SelfAssessedLevel } from "./self-assessed-level";

/** One visible skill area with the caller's own level (`null` = not assessed). */
export interface SkillRowDto {
  treeId: string;
  name: string;
  level: SelfAssessedLevel | null;
}

export interface OwnSkillsDto {
  skills: SkillRowDto[];
  /** True iff more raw catalog documents exist than the bounded window. */
  truncated: boolean;
  profile: "ok" | "unreadable";
}

const collator = new Intl.Collator("nb");

/**
 * Presentation order (SPEC BR-8): `name` (`nb`), tie-break `treeId`. Pure; returns
 * a new array. This never decides which documents enter the catalog window.
 */
export function sortSkillRows<T extends { treeId: string; name: string }>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) => collator.compare(a.name, b.name) || (a.treeId < b.treeId ? -1 : a.treeId > b.treeId ? 1 : 0),
  );
}

/** Descriptive counts only (SPEC BR-26). Levels are ordinal: no ratio or aggregate. */
export interface SkillOverview {
  assessedCount: number;
  totalCount: number;
  perLevelCounts: Record<SelfAssessedLevel, number>;
}

/** Counts over the given (visible) rows only. */
export function deriveOverview(rows: readonly Pick<SkillRowDto, "level">[]): SkillOverview {
  const perLevelCounts = Object.fromEntries(SELF_ASSESSED_LEVELS.map((level) => [level, 0])) as Record<
    SelfAssessedLevel,
    number
  >;
  let assessedCount = 0;
  for (const { level } of rows) {
    if (level === null) continue;
    assessedCount += 1;
    perLevelCounts[level] += 1;
  }
  return { assessedCount, totalCount: rows.length, perLevelCounts };
}

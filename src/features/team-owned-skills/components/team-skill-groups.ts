/**
 * Groups a team's active competencies by their real `category` (team-owned skills only). Categories are never invented:
 * a competency without a category goes into one trailing group whose `category` is null. Presentation only; the grouping
 * does not touch the stored data or the assessment rules.
 */
export interface CategoryGroup<T> {
  /** The stored category, or null for competencies without one. */
  readonly category: string | null;
  readonly items: readonly T[];
}

function normalizeCategory(category: string | null | undefined): string | null {
  const trimmed = category?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export function groupTeamSkillsByCategory<T extends { readonly category: string | null | undefined }>(
  skills: readonly T[],
): CategoryGroup<T>[] {
  const byCategory = new Map<string, T[]>();
  const uncategorized: T[] = [];
  for (const skill of skills) {
    const category = normalizeCategory(skill.category);
    if (category === null) {
      uncategorized.push(skill);
      continue;
    }
    const existing = byCategory.get(category);
    if (existing) existing.push(skill);
    else byCategory.set(category, [skill]);
  }
  const groups: CategoryGroup<T>[] = [...byCategory.keys()]
    .sort((a, b) => a.localeCompare(b, "nb"))
    .map((category) => ({ category, items: byCategory.get(category) ?? [] }));
  if (uncategorized.length > 0) groups.push({ category: null, items: uncategorized });
  return groups;
}

/**
 * Share of a team's active competencies that are assessed, in whole percent. A team with none is 0, never a division by zero.
 * Used only for the decorative progress bar; the text beside it carries the same figure.
 */
export function assessmentPercent(assessed: number, active: number): number {
  if (active <= 0) return 0;
  return Math.round((Math.min(assessed, active) / active) * 100);
}

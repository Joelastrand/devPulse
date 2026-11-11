import { isSelfAssessedLevel, type SelfAssessedLevel } from "./self-assessed-level";
import type { SkillRowDto } from "./skill-profile-view";

/**
 * Pure model for the `/me/skills` Oversikt (overview) and its personal radar (C1 BR-29 as amended 2026-11-10).
 *
 * It only derives counts, lists and axes from the signed-in person's own assessments and, when a target role is selected,
 * that owner-only comparison. No mean, percentage, score or ranking is computed (C1 BR-22, BR-26). Unassessed skills are
 * never drawn as zero: they are omitted from the radar and counted as "not assessed".
 */

/** Minimal comparison input: the owner's target role and its rows (structural, so this module does not import role-profiles). */
export interface OverviewComparisonInput {
  readonly targetName: string;
  readonly rows: readonly {
    readonly treeId: string;
    readonly treeName: string | null;
    readonly expectedLevel: number;
    readonly status: "meets" | "development_opportunity" | "not_assessed" | "area_unavailable";
    readonly ownLevel: number | null;
  }[];
}

export interface OverviewSummary {
  /** Assessed skills at level 3 or higher (C1 `developmentDetail`). A count, never an average. */
  readonly atLeastIndependent: number;
  /** Assessed skills, out of the visible skills (BR-26). */
  readonly assessedCount: number;
  readonly totalCount: number;
  /** Assessed skills at level 1 or 2 (C1 `areasDetail`). */
  readonly developmentAreaCount: number;
}

export interface OverviewTarget {
  readonly name: string;
  /** Rows that have an expectation in the target role. */
  readonly expectationCount: number;
  readonly meetsCount: number;
  readonly developmentCount: number;
}

export interface OverviewAreaRow {
  readonly treeId: string;
  readonly name: string;
  readonly level: SelfAssessedLevel | null;
  /** Expected level in the target role, when the target has one for this skill. */
  readonly expectedLevel: SelfAssessedLevel | null;
  /** Status against the target, or null when no target is selected or the skill has no expectation. */
  readonly status: "meets" | "development_opportunity" | "not_assessed" | "area_unavailable" | null;
}

export interface SuggestionRow {
  readonly treeId: string;
  readonly name: string;
  readonly expectedLevel: SelfAssessedLevel | null;
}

export interface OverviewModel {
  readonly summary: OverviewSummary;
  readonly target: OverviewTarget | null;
  /** Skill areas in the canonical list order (the order the server returned). */
  readonly areas: readonly OverviewAreaRow[];
  /** Development suggestions: target gaps when a target is selected, otherwise assessed level 1 or 2 skills. */
  readonly suggestions: readonly SuggestionRow[];
  /** Development gaps as a total (for the banner); equals `target.developmentCount` or the level 1-2 count. */
  readonly developmentTotal: number;
}

function toLevel(value: number | null | undefined): SelfAssessedLevel | null {
  return typeof value === "number" && isSelfAssessedLevel(value) ? value : null;
}

export function buildOverviewModel(
  skills: readonly SkillRowDto[],
  comparison: OverviewComparisonInput | null,
): OverviewModel {
  const assessed = skills.filter((skill) => skill.level !== null);
  const summary: OverviewSummary = {
    atLeastIndependent: assessed.filter((skill) => (skill.level ?? 0) >= 3).length,
    assessedCount: assessed.length,
    totalCount: skills.length,
    developmentAreaCount: assessed.filter((skill) => skill.level === 1 || skill.level === 2).length,
  };

  const rowsByTree = new Map((comparison?.rows ?? []).map((row) => [row.treeId, row]));
  const areas: OverviewAreaRow[] = skills.map((skill) => {
    const row = rowsByTree.get(skill.treeId);
    return {
      treeId: skill.treeId,
      name: skill.name,
      level: skill.level,
      expectedLevel: toLevel(row?.expectedLevel),
      status: comparison && row ? row.status : null,
    };
  });

  if (comparison === null) {
    const suggestions = areas
      .filter((area) => area.level === 1 || area.level === 2)
      .map((area) => ({ treeId: area.treeId, name: area.name, expectedLevel: null }));
    return { summary, target: null, areas, suggestions, developmentTotal: summary.developmentAreaCount };
  }

  const target: OverviewTarget = {
    name: comparison.targetName,
    expectationCount: comparison.rows.length,
    meetsCount: comparison.rows.filter((row) => row.status === "meets").length,
    developmentCount: comparison.rows.filter((row) => row.status === "development_opportunity").length,
  };
  const suggestions: SuggestionRow[] = areas
    .filter((area) => area.status === "development_opportunity")
    .map((area) => ({ treeId: area.treeId, name: area.name, expectedLevel: area.expectedLevel }));
  return { summary, target, areas, suggestions, developmentTotal: target.developmentCount };
}

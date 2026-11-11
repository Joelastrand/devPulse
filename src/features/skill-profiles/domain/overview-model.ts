import { isSelfAssessedLevel, type SelfAssessedLevel } from "./self-assessed-level";
import type { SkillRowDto } from "./skill-profile-view";

/**
 * Pure model for the `/me/skills` Oversikt. It only derives descriptive counts and the person's own assessed levels.
 * Skills are independent of organizational roles: there is no expected level, no target, no comparison and no
 * development gap. No mean, percentage, score or ranking is computed. Unassessed skills are counted, never drawn as zero.
 */

export interface OverviewSummary {
  /** Assessed skills at level 3 or higher ("Ferdigheter på nivå 3–4"). A count, never an average. */
  readonly atLeastIndependent: number;
  /** Assessed skills, out of the visible skills ("Vurderte ferdigheter"). */
  readonly assessedCount: number;
  readonly totalCount: number;
  /** Assessed skills at level 1 or 2 ("Ferdigheter å utvikle"). Descriptive only, never a job-role deficit. */
  readonly developmentAreaCount: number;
}

export interface OverviewAreaRow {
  readonly treeId: string;
  readonly name: string;
  /** The person's own assessment, or null when the skill is not assessed. */
  readonly level: SelfAssessedLevel | null;
}

export interface OverviewModel {
  readonly summary: OverviewSummary;
  /** Skill areas in the canonical list order (the order the server returned). */
  readonly areas: readonly OverviewAreaRow[];
  /** Number of visible skills the person has not assessed yet. */
  readonly unassessedCount: number;
}

function toLevel(value: number | null | undefined): SelfAssessedLevel | null {
  return typeof value === "number" && isSelfAssessedLevel(value) ? value : null;
}

export function buildOverviewModel(skills: readonly SkillRowDto[]): OverviewModel {
  const assessed = skills.filter((skill) => skill.level !== null);
  const summary: OverviewSummary = {
    atLeastIndependent: assessed.filter((skill) => (skill.level ?? 0) >= 3).length,
    assessedCount: assessed.length,
    totalCount: skills.length,
    developmentAreaCount: assessed.filter((skill) => skill.level === 1 || skill.level === 2).length,
  };
  const areas: OverviewAreaRow[] = skills.map((skill) => ({
    treeId: skill.treeId,
    name: skill.name,
    level: toLevel(skill.level),
  }));
  return { summary, areas, unassessedCount: skills.length - assessed.length };
}

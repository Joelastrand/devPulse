import type { SelfAssessedLevel } from "./self-assessed-level";

/**
 * Pure create-only decision for a planned set of self-assessed levels (trusted seed; no I/O). Lives in the domain so the
 * owning store and tests can use it without importing the store module.
 *
 * `openedLevels` are the levels that opened with the configured key, keyed by tree id. An absent profile → create. Every
 * planned tree must be present and equal → skip. Anything else → conflict; a partial profile is never completed.
 */
export type SkillSeedAction = "create" | "skip";

export function classifySkillLevelSeed(
  profileExists: boolean,
  openedLevels: Readonly<Record<string, SelfAssessedLevel>>,
  planned: readonly { treeId: string; level: SelfAssessedLevel }[],
): SkillSeedAction | "conflict" {
  if (!profileExists) return "create";
  return planned.every(({ treeId, level }) => openedLevels[treeId] === level) ? "skip" : "conflict";
}

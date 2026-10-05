/**
 * Canonical personal self-assessment scale (SPEC BR-4).
 *
 * Levels are ORDINAL categories, not measurements: the numbers only order the
 * levels. Nothing may average, sum, weight, normalise or otherwise do
 * arithmetic over levels, across skills or people. Absence of a level means
 * "not assessed"; there is no level 0.
 *
 * This module owns the canonical meaning of each level. Norwegian labels and
 * descriptions are UI copy and live separately in the feature's `copy.ts`;
 * rewording them is free as long as the meaning here is unchanged. Changing
 * a meaning or the number of levels is a scale/schema decision that needs
 * migration consideration, because persisted values would change meaning.
 *
 * This scale is independent of SkillTree stages/nodes (team maturity).
 */
export const SELF_ASSESSED_LEVELS = [1, 2, 3, 4] as const;

export type SelfAssessedLevel = (typeof SELF_ASSESSED_LEVELS)[number];

export interface SelfAssessedLevelMeaning {
  /** What the level means. */
  readonly meaning: string;
  /** Illustration only; never part of the definition or a requirement. */
  readonly example?: string;
}

export const SELF_ASSESSED_LEVEL_MEANINGS: Readonly<Record<SelfAssessedLevel, SelfAssessedLevelMeaning>> = {
  1: { meaning: "Limited or early familiarity with the skill area." },
  2: { meaning: "Can perform relevant work with support or guidance." },
  3: { meaning: "Can work independently in ordinary situations." },
  4: {
    meaning:
      "Deep or advanced proficiency: handles complex or unfamiliar situations and contributes to or shapes good practice.",
    // Teaching ability and domain proficiency are different things: guiding
    // others may illustrate level 4 but must never be required for it.
    example: "Guiding or mentoring others.",
  },
};

export function isSelfAssessedLevel(value: unknown): value is SelfAssessedLevel {
  return typeof value === "number" && (SELF_ASSESSED_LEVELS as readonly number[]).includes(value);
}

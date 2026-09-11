/** One legacy team's seed shape: the exact document ID to assign, and its
 * initial display name. */
export interface LegacyTeamSeed {
  teamId: string;
  name: string;
}

/**
 * The original, static list of legacy team identifiers the pulse survey
 * used before TASK-006 (formerly `ALLOWED_TEAM_IDS`,
 * `src/features/pulse-survey/domain/teams.ts` — deleted in TASK-011 once
 * this was its only remaining reader). Inlined here directly since this
 * one-time seed migration is now the sole reason these four literal
 * strings still matter anywhere in the codebase.
 */
const LEGACY_TEAM_IDS = ["platform", "web-app", "mobile", "data-platform"] as const;

/**
 * The one-time seed set for TASK-006's legacy migration: one `teams`
 * document per pre-existing legacy team id, using that exact literal
 * string as the Firestore document ID (never a derived/invented ID), and
 * `name` set to the same string initially
 * (docs/features/team-management/SPEC.md — Architecture decisions →
 * "Continuity with the existing static team list"). This is a one-time
 * seed-migration constant, kept separate from the pulse-survey's dynamic
 * runtime team source (`list-active-teams.ts`), which never reads it.
 */
export const LEGACY_TEAM_SEEDS: readonly LegacyTeamSeed[] = LEGACY_TEAM_IDS.map(
  (teamId) => ({ teamId, name: teamId }),
);

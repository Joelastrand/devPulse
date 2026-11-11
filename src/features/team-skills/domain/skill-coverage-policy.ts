/**
 * Sole owner of the C2 policy constants (SPEC BR-8, BR-13, BR-19). Client,
 * server and tests import these; the literals are never duplicated.
 * Deliberately not configurable: no env, team setting, parameter or UI.
 */

/**
 * Fixed privacy threshold `k`: minimum eligible contributors per skill. Owner decision (unified team competence
 * feature, final): k = 3, replacing the previous 5. Applies to every shared-assessment aggregate (team-owned skill
 * aggregate and the categorical coverage view). Lowering it is a material change: see SECURITY.md invariant 34.
 */
export const SKILL_COVERAGE_MIN_CONTRIBUTORS = 3;

/**
 * Current participation-notice version. Stored participation is effective only
 * when its version equals this value. Bump on a material change of the notice
 * contract; editorial rewording does not bump it.
 *
 * Version 2: the threshold stated in the notice changed from 5 to 3. Every participation recorded under version 1
 * lapses and each member must re-consent (owner-approved consequence, SECURITY.md invariant 34).
 */
export const SKILL_CONTRIBUTION_NOTICE_VERSION = 2;

/** Defensive read bound for the membership scan; not a team-size limit. */
export const TEAM_SKILL_COHORT_SCAN_MAX = 500;

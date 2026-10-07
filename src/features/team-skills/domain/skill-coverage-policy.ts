/**
 * Sole owner of the C2 policy constants (SPEC BR-8, BR-13, BR-19). Client,
 * server and tests import these; the literals are never duplicated.
 * Deliberately not configurable: no env, team setting, parameter or UI.
 */

/** Fixed privacy threshold `k`: minimum eligible contributors per skill. */
export const SKILL_COVERAGE_MIN_CONTRIBUTORS = 5;

/**
 * Current participation-notice version. Stored participation is effective only
 * when its version equals this value. Bump on a material change of the notice
 * contract; editorial rewording does not bump it.
 */
export const SKILL_CONTRIBUTION_NOTICE_VERSION = 1;

/** Defensive read bound for the membership scan; not a team-size limit. */
export const TEAM_SKILL_COHORT_SCAN_MAX = 500;

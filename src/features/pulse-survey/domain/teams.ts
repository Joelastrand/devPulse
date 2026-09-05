/**
 * The application-defined, static list of teams a respondent may self-declare.
 *
 * This is a UI convenience only. The authoritative check is server-side
 * membership in this array (see `validateSubmission`); a client-supplied
 * `teamId` is never trusted on its own. Migrating this to a Firestore-backed
 * `Team` concept is an explicit, deferred Phase 2 decision (SPEC.md).
 */
export const ALLOWED_TEAM_IDS = [
  "platform",
  "web-app",
  "mobile",
  "data-platform",
] as const;

export type TeamId = (typeof ALLOWED_TEAM_IDS)[number];

export function isAllowedTeamId(value: unknown): value is TeamId {
  return (
    typeof value === "string" &&
    (ALLOWED_TEAM_IDS as readonly string[]).includes(value)
  );
}

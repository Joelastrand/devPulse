/**
 * Shared, non-sensitive UI copy for a `requestTeamAccess` failure
 * (`src/features/teams/client/teams-overview-gateway.ts`), used by both
 * `TeamsOverview` and `TeamDetail` so the request-access affordance reads
 * identically wherever it appears (docs/features/team-management/TASKS.md —
 * TASK-008: "do not duplicate the request-access component").
 */
export function requestAccessErrorMessage(error: string): string {
  if (error === "team_disabled") {
    return "This team is currently disabled.";
  }
  if (error === "unverified") {
    return "Verify your email to request access.";
  }
  return "Something went wrong. Please try again.";
}

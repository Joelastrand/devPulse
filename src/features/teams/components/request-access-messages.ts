import { teamsCopy } from "../copy";

/**
 * Shared, non-sensitive UI copy for a `requestTeamAccess` failure
 * (`src/features/teams/client/teams-overview-gateway.ts`), used by both
 * `TeamsOverview` and `TeamDetail` so the request-access affordance reads
 * identically wherever it appears (docs/features/team-management/TASKS.md —
 * TASK-008: "do not duplicate the request-access component").
 */
export function requestAccessErrorMessage(error: string): string {
  if (error === "team_disabled") {
    return teamsCopy.requestAccessError.teamDisabled;
  }
  if (error === "unverified") {
    return teamsCopy.requestAccessError.unverified;
  }
  return teamsCopy.requestAccessError.generic;
}

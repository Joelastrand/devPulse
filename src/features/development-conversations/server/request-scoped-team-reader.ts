import "server-only";
import type { TeamEligibilityReader } from "./team-eligibility";

/**
 * One request's memo of the raw team and membership reads (TASK-023 owner-list cost). It caches the read promises, not
 * any decision: each caller still runs its own eligibility or binding check on the result. A rejected read stays a
 * rejection for every caller, so an operational failure is observed the same way everywhere in the request.
 *
 * Create one per operation call and never keep it past that call. It holds no module-level state.
 */
export function requestScopedTeamReader(reader: TeamEligibilityReader): TeamEligibilityReader {
  const statuses = new Map<string, Promise<unknown>>();
  const memberships = new Map<string, Promise<unknown>>();
  return {
    getTeamStatus(teamId) {
      let status = statuses.get(teamId);
      if (status === undefined) {
        status = reader.getTeamStatus(teamId);
        statuses.set(teamId, status);
      }
      return status;
    },
    getMembership(uid, teamId) {
      // A JSON tuple, so no character in either id can make two different pairs share a key. A NUL delimiter would not:
      // the id grammars do not forbid it (assertUidSegment and isNonEmptyString accept any non-empty string).
      // A JSON tuple, so no character in either id can make two different pairs share a key. A NUL delimiter would not:
      // the id grammars do not forbid it (assertUidSegment and isNonEmptyString accept any non-empty string).
      const key = JSON.stringify([uid, teamId]);
      let membership = memberships.get(key);
      if (membership === undefined) {
        membership = reader.getMembership(uid, teamId);
        memberships.set(key, membership);
      }
      return membership;
    },
  };
}

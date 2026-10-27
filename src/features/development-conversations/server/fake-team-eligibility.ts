import "server-only";
import { membershipDocId } from "../../teams/domain/team-membership";
import type { TeamEligibilityReader } from "./team-eligibility";

/**
 * In-memory fixture for the team reads. `teamStatus` maps a team id to the raw `status` value, and a missing key is an
 * absent team document. `memberships` maps `{uid}__{teamId}` to raw membership data, with no normalization.
 */
export interface FakeTeamEligibilityState {
  teamStatus: Record<string, unknown>;
  memberships: Record<string, unknown>;
  failTeamRead?: boolean;
  failMembershipRead?: boolean;
}

export function createFakeTeamEligibilityReader(state: FakeTeamEligibilityState): TeamEligibilityReader {
  return {
    async getTeamStatus(teamId) {
      if (state.failTeamRead) {
        throw new Error("simulated team read failure");
      }
      return state.teamStatus[teamId];
    },
    async getMembership(uid, teamId) {
      if (state.failMembershipRead) {
        throw new Error("simulated membership read failure");
      }
      return state.memberships[membershipDocId(uid, teamId)];
    },
  };
}

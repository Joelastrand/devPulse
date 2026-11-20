import "server-only";
import { membershipDocId } from "../../teams/domain/team-membership";
import type { MembershipRefReader, TeamEligibilityReader, TeamMemberListReader } from "./team-eligibility";
import type { OwnMembershipListReader, SharedTeamReader } from "./shared-team-binding";

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

export function createFakeMembershipRefReader(state: FakeTeamEligibilityState): MembershipRefReader {
  return {
    async findMembershipsByRef(memberRef, limit) {
      if (state.failMembershipRead) {
        throw new Error("simulated membership read failure");
      }
      return Object.entries(state.memberships)
        .filter(([, data]) => typeof data === "object" && data !== null && (data as Record<string, unknown>).memberRef === memberRef)
        .slice(0, limit)
        .map(([id, data]) => ({ id, data }));
    },
  };
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

/** The in-memory owner-membership list: the raw documents whose `uid` field is `uid`, bounded by `limit`. */
export function createFakeOwnMembershipListReader(state: FakeTeamEligibilityState): OwnMembershipListReader {
  return {
    async listOwnMemberships(uid, limit) {
      if (state.failMembershipRead) {
        throw new Error("simulated membership read failure");
      }
      return Object.entries(state.memberships)
        .filter(([, data]) => typeof data === "object" && data !== null && (data as Record<string, unknown>).uid === uid)
        .slice(0, limit)
        .map(([id, data]) => ({ id, data }));
    },
  };
}

/** The in-memory shared-team reader: point reads, the membership-by-reference lookup and the owner-membership list (A2.1). */
export function createFakeSharedTeamReader(state: FakeTeamEligibilityState): SharedTeamReader {
  return {
    ...createFakeTeamEligibilityReader(state),
    ...createFakeMembershipRefReader(state),
    ...createFakeOwnMembershipListReader(state),
  };
}

/** The in-memory bounded list of one team's raw membership documents (the eligible-colleague picker, A2.1 revised). */
export function createFakeTeamMemberListReader(state: FakeTeamEligibilityState): TeamMemberListReader {
  return {
    async listTeamMemberships(teamId, limit) {
      if (state.failMembershipRead) {
        throw new Error("simulated membership read failure");
      }
      return Object.entries(state.memberships)
        .filter(([, data]) => typeof data === "object" && data !== null && (data as Record<string, unknown>).teamId === teamId)
        .slice(0, limit)
        .map(([id, data]) => ({ id, data }));
    },
  };
}

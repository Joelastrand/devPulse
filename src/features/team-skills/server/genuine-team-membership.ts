import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import { isValidTeamStatus, type TeamStatus } from "../../teams/domain/team";
import {
  isValidMembershipFor,
  membershipDocId,
  membershipRoleOf,
} from "../../teams/domain/team-membership";

const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";

/**
 * Genuine-membership seam for C2 (SPEC BR-18). Unlike `authorizeTeamAccess`
 * and `resolveTeamRole`, which classify an app admin before looking at
 * membership, this answers only "does the verified caller hold a membership
 * document for this team, and with which role?". App-admin status is never
 * consulted: it neither grants nor removes a genuine membership.
 *
 * Deliberately exposes facts, not permissions. Each C2 operation (need
 * write, coverage read, participation) composes its own rule from these.
 */
export type GenuineRelationship = "denied" | "member" | "lead";

export type GenuineMembershipResult =
  | { ok: true; relationship: GenuineRelationship; teamStatus: TeamStatus }
  | { ok: false; error: "read_failed" };

/** Raw, unvalidated reads (same shape as the `authorizeTeamAccess` seam). */
export interface GenuineMembershipReads {
  /** Raw `status` of `teams/{teamId}`, or `undefined` if no such document. */
  getTeamStatus(teamId: string): Promise<unknown>;
  /** Raw `teamMemberships/{uid}__{teamId}` data, or `undefined` if absent. */
  getMembership(uid: string, teamId: string): Promise<unknown>;
}

export interface GenuineMembershipDeps {
  reads?: GenuineMembershipReads;
}

function getDefaultReads(): GenuineMembershipReads {
  return {
    async getTeamStatus(teamId) {
      const snapshot = await getFirestoreDb()
        .collection(TEAMS_COLLECTION)
        .doc(teamId)
        .get();
      return snapshot.exists ? snapshot.data()?.status : undefined;
    },
    async getMembership(uid, teamId) {
      const snapshot = await getFirestoreDb()
        .collection(MEMBERSHIPS_COLLECTION)
        .doc(membershipDocId(uid, teamId))
        .get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
  };
}

/**
 * Order: team read (missing/invalid status ⇒ denied for everyone) →
 * membership read, validated for the exact (verified uid, teamId) pair →
 * role (exactly `lead`, anything else is `member`). A read failure is
 * `read_failed`, never `denied`. A disabled team still reports the stored
 * relationship; callers needing an active team must check `teamStatus`
 * (use the `require*` helpers).
 */
export async function resolveGenuineTeamMembership(
  identity: VerifiedIdentity,
  teamId: string,
  deps: GenuineMembershipDeps = {},
): Promise<GenuineMembershipResult> {
  const reads = deps.reads ?? getDefaultReads();

  let rawStatus: unknown;
  try {
    rawStatus = await reads.getTeamStatus(teamId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  // Nothing to act on: report fail-closed values, never "active".
  if (!isValidTeamStatus(rawStatus)) {
    return { ok: true, relationship: "denied", teamStatus: "disabled" };
  }

  let rawMembership: unknown;
  try {
    rawMembership = await reads.getMembership(identity.uid, teamId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  if (!isValidMembershipFor(rawMembership, { uid: identity.uid, teamId })) {
    return { ok: true, relationship: "denied", teamStatus: rawStatus };
  }

  return {
    ok: true,
    relationship: membershipRoleOf(rawMembership),
    teamStatus: rawStatus,
  };
}

export type RequireGenuineError = "forbidden" | "team_disabled" | "read_failed";

export type RequireGenuineMemberResult =
  | { ok: true; relationship: "member" | "lead" }
  | { ok: false; error: RequireGenuineError };

export type RequireGenuineLeadResult =
  | { ok: true }
  | { ok: false; error: RequireGenuineError };

/**
 * Genuine member of an **active** team. A non-member is `forbidden` and
 * never learns `team_disabled`.
 */
export async function requireGenuineMember(
  identity: VerifiedIdentity,
  teamId: string,
  deps: GenuineMembershipDeps = {},
): Promise<RequireGenuineMemberResult> {
  const result = await resolveGenuineTeamMembership(identity, teamId, deps);
  if (!result.ok) return result;
  if (result.relationship === "denied") {
    return { ok: false, error: "forbidden" };
  }
  if (result.teamStatus !== "active") {
    return { ok: false, error: "team_disabled" };
  }
  return { ok: true, relationship: result.relationship };
}

/**
 * Genuine lead of an **active** team. Role is checked before status, so an
 * ordinary member is `forbidden` (not `team_disabled`) on a disabled team.
 */
export async function requireGenuineLead(
  identity: VerifiedIdentity,
  teamId: string,
  deps: GenuineMembershipDeps = {},
): Promise<RequireGenuineLeadResult> {
  const result = await resolveGenuineTeamMembership(identity, teamId, deps);
  if (!result.ok) return result;
  if (result.relationship !== "lead") {
    return { ok: false, error: "forbidden" };
  }
  if (result.teamStatus !== "active") {
    return { ok: false, error: "team_disabled" };
  }
  return { ok: true };
}

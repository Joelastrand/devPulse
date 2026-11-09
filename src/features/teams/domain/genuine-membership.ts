import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import { isValidTeamStatus, type TeamStatus } from "./team";
import { isValidMembershipFor, membershipRoleOf } from "./team-membership";

/**
 * Pure genuine-membership decision (SPEC BR-18), shared by every owner that needs it. Persistence reads and the
 * superadmin lookup are injected by the caller, so the rule exists exactly once and each owner keeps its own reads.
 * Order and semantics are unchanged from the C2 seam: team read → membership read validated for the exact
 * (verified uid, teamId) pair → role (exactly `teamadmin`, anything else `member`).
 */
export type GenuineRelationship = "denied" | "member" | "teamadmin";

export type GenuineMembershipResult =
  | { ok: true; relationship: GenuineRelationship; teamStatus: TeamStatus }
  | { ok: false; error: "read_failed" };

/** Raw, unvalidated reads. */
export interface GenuineMembershipReads {
  /** Raw `status` of `teams/{teamId}`, or `undefined` if no such document. */
  getTeamStatus(teamId: string): Promise<unknown>;
  /** Raw `teamMemberships/{uid}__{teamId}` data, or `undefined` if absent. */
  getMembership(uid: string, teamId: string): Promise<unknown>;
}

export type RequireGenuineError = "forbidden" | "team_disabled" | "read_failed";

export type RequireGenuineMemberResult =
  | { ok: true; relationship: "member" | "teamadmin" }
  | { ok: false; error: RequireGenuineError };

export type RequireTeamAdministratorResult = { ok: true } | { ok: false; error: RequireGenuineError };

/** Injected app-admin check (`isAppAdmin` in production). Must reject on a registry read failure. */
export type IsAppAdminCheck = (identity: VerifiedIdentity) => Promise<boolean>;

export async function resolveGenuineTeamMembershipWith(
  identity: VerifiedIdentity,
  teamId: string,
  reads: GenuineMembershipReads,
): Promise<GenuineMembershipResult> {
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

  return { ok: true, relationship: membershipRoleOf(rawMembership), teamStatus: rawStatus };
}

/** Genuine member of an active team. A non-member is `forbidden` and never learns `team_disabled`. */
export async function requireGenuineMemberWith(
  identity: VerifiedIdentity,
  teamId: string,
  reads: GenuineMembershipReads,
): Promise<RequireGenuineMemberResult> {
  const result = await resolveGenuineTeamMembershipWith(identity, teamId, reads);
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
 * Team administrator of an active team: a superadmin (`isAdmin`) or a genuine `teamadmin` membership. Role is checked
 * before status, so an ordinary member is `forbidden` (not `team_disabled`) on a disabled team.
 */
export async function requireTeamAdministratorWith(
  identity: VerifiedIdentity,
  teamId: string,
  reads: GenuineMembershipReads,
  isAdmin: IsAppAdminCheck,
): Promise<RequireTeamAdministratorResult> {
  const result = await resolveGenuineTeamMembershipWith(identity, teamId, reads);
  if (!result.ok) return result;
  const superadmin = await isAdmin(identity);
  if (!superadmin && result.relationship !== "teamadmin") {
    return { ok: false, error: "forbidden" };
  }
  if (result.teamStatus !== "active") {
    return { ok: false, error: "team_disabled" };
  }
  return { ok: true };
}

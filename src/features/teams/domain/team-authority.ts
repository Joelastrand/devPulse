import { isValidMembershipFor, membershipRoleOf } from "./team-membership";

/**
 * Team visibility (docs/features/teamadmin-and-team-visibility/SPEC.md).
 * A missing or malformed persisted value is `private`: only an explicit,
 * valid `"public"` ever exposes a team to anonymous readers.
 */
export type TeamVisibility = "private" | "public";

export const DEFAULT_TEAM_VISIBILITY: TeamVisibility = "private";

export function isTeamVisibility(value: unknown): value is TeamVisibility {
  return value === "private" || value === "public";
}

export function effectiveTeamVisibility(raw: unknown): TeamVisibility {
  return raw === "public" ? "public" : "private";
}

/**
 * The single team-administration decision (superadmin or teamadmin of this
 * team). `isSuperadmin` must be computed from the verified identity by the
 * caller; `membership` is the raw `teamMemberships` read for the same
 * (uid, teamId) pair, validated here. Team status is NOT decided here: every
 * write checks `status === "active"` itself, inside its own transaction.
 */
export function canAdministerTeam(input: {
  isSuperadmin: boolean;
  uid: string;
  teamId: string;
  membership: unknown;
}): boolean {
  if (input.isSuperadmin) return true;
  return (
    isValidMembershipFor(input.membership, { uid: input.uid, teamId: input.teamId }) &&
    membershipRoleOf(input.membership) === "teamadmin"
  );
}

/** Read-side write right for UI and list `canEdit` flags: admin-capable role on an active team. */
export function canAdministerTeamScope(input: {
  role: "admin" | "teamadmin" | "member" | "denied";
  teamStatus: "active" | "disabled" | null;
}): boolean {
  return input.teamStatus === "active" && (input.role === "admin" || input.role === "teamadmin");
}

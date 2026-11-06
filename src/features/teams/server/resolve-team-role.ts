import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { type VerifiedIdentity } from "../../auth/server/verify-identity";
import { isValidTeamStatus } from "../domain/team";
import { isValidMembershipFor, membershipDocId, membershipRoleOf } from "../domain/team-membership";
import { canAdministerTeamScope } from "../domain/team-authority";
import {
  authorizeTeamAccess,
  type AuthorizeTeamAccessCollection,
  type AuthorizeTeamAccessDeps,
} from "./authorize-team-access";

const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";

/**
 * A caller's effective team-scoped role (docs/features/teamadmin-and-team-visibility/SPEC.md).
 * `admin` is the superadmin (global app admin), `teamadmin` a membership with
 * the approved team-admin role, `member` any other genuine membership.
 * This is a team authorization role, never a professional role.
 */
export type TeamRole = "admin" | "teamadmin" | "member" | "denied";

/** `ok: false` means the decision could not be made — never collapsed into `"denied"`. */
export type ResolveTeamRoleResult =
  | { ok: true; role: TeamRole; canAdminister: boolean }
  | { ok: false; error: "read_failed" };

export type ResolveTeamRoleDeps = AuthorizeTeamAccessDeps;

// Same two document reads `authorizeTeamAccess` uses by default, plus the
// team status read needed for the write right. Every decision about the raw
// values is made by `authorizeTeamAccess` or the shared domain helpers.
function getDefaultCollection(): AuthorizeTeamAccessCollection {
  return {
    async getTeamStatus(teamId) {
      const snapshot = await getFirestoreDb().collection(TEAMS_COLLECTION).doc(teamId).get();
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
 * Resolves a *verified* identity's relationship to one team, re-derived from
 * fresh server-side state on every call. The identity must already have been
 * verified by the caller (`verifyIdToken`); nothing the client sends decides a role.
 *
 * `canAdminister` is the single server-side write right for team-scoped
 * administration: the caller is a superadmin or a genuine `teamadmin` AND the
 * team is `active`. Callers must use it for `canEdit` flags and must still
 * re-check the same rule inside their write transactions.
 *
 * A legacy stored `role: "lead"` classifies as `member` and grants nothing.
 */
export async function resolveTeamRole(
  identity: VerifiedIdentity,
  teamId: string,
  deps: ResolveTeamRoleDeps = {},
): Promise<ResolveTeamRoleResult> {
  const collection = deps.collection ?? getDefaultCollection();

  const authorized = await authorizeTeamAccess(identity, teamId, { isSuperadmin: deps.isSuperadmin, collection });
  if (!authorized.ok) {
    return { ok: false, error: "read_failed" };
  }

  try {
    const rawStatus = await collection.getTeamStatus(teamId);
    const teamStatus = isValidTeamStatus(rawStatus) ? rawStatus : null;

    if (authorized.access === "denied") {
      return { ok: true, role: "denied", canAdminister: false };
    }
    if (authorized.access === "admin") {
      return { ok: true, role: "admin", canAdminister: canAdministerTeamScope({ role: "admin", teamStatus }) };
    }

    const membership = await collection.getMembership(identity.uid, teamId);
    if (!isValidMembershipFor(membership, { uid: identity.uid, teamId })) {
      return { ok: true, role: "denied", canAdminister: false };
    }
    const role: TeamRole = membershipRoleOf(membership) === "teamadmin" ? "teamadmin" : "member";
    return { ok: true, role, canAdminister: canAdministerTeamScope({ role, teamStatus }) };
  } catch {
    return { ok: false, error: "read_failed" };
  }
}

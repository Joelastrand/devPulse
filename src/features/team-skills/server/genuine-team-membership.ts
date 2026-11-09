import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { type VerifiedIdentity } from "../../auth/server/verify-identity";
import { isAppAdmin, type IsAppAdminDeps } from "../../teams/domain/app-admin";
import {
  requireGenuineMemberWith,
  requireTeamAdministratorWith,
  resolveGenuineTeamMembershipWith,
  type GenuineMembershipReads,
  type GenuineMembershipResult,
  type RequireGenuineMemberResult,
  type RequireTeamAdministratorResult,
} from "../../teams/domain/genuine-membership";
import { membershipDocId } from "../../teams/domain/team-membership";

const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";

/**
 * Genuine-membership seam for C2 (SPEC BR-18). The decision lives in `teams/domain/genuine-membership`; this module
 * supplies the Firestore reads and the superadmin lookup. App-admin status is never consulted by the member rule.
 */
export interface GenuineMembershipDeps {
  isSuperadmin?: IsAppAdminDeps["isSuperadmin"];
  reads?: GenuineMembershipReads;
}

function getDefaultReads(): GenuineMembershipReads {
  return {
    async getTeamStatus(teamId) {
      const snapshot = await getFirestoreDb().collection(TEAMS_COLLECTION).doc(teamId).get();
      return snapshot.exists ? snapshot.data()?.status : undefined;
    },
    async getMembership(uid, teamId) {
      const snapshot = await getFirestoreDb().collection(MEMBERSHIPS_COLLECTION).doc(membershipDocId(uid, teamId)).get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
  };
}

export async function resolveGenuineTeamMembership(
  identity: VerifiedIdentity,
  teamId: string,
  deps: GenuineMembershipDeps = {},
): Promise<GenuineMembershipResult> {
  return resolveGenuineTeamMembershipWith(identity, teamId, deps.reads ?? getDefaultReads());
}

/** Genuine member of an **active** team. */
export async function requireGenuineMember(
  identity: VerifiedIdentity,
  teamId: string,
  deps: GenuineMembershipDeps = {},
): Promise<RequireGenuineMemberResult> {
  return requireGenuineMemberWith(identity, teamId, deps.reads ?? getDefaultReads());
}

/** Team administrator of an **active** team: a superadmin or a genuine `teamadmin` membership. */
export async function requireTeamAdministrator(
  identity: VerifiedIdentity,
  teamId: string,
  deps: GenuineMembershipDeps = {},
): Promise<RequireTeamAdministratorResult> {
  return requireTeamAdministratorWith(identity, teamId, deps.reads ?? getDefaultReads(), (id) =>
    isAppAdmin(id, { isSuperadmin: deps.isSuperadmin }),
  );
}

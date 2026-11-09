import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { type VerifiedIdentity } from "../../auth/server/verify-identity";
import { isAppAdmin, type IsAppAdminDeps } from "../../teams/domain/app-admin";
import {
  requireGenuineMemberWith,
  requireTeamAdministratorWith,
  type GenuineMembershipReads,
  type RequireGenuineMemberResult,
  type RequireTeamAdministratorResult,
} from "../../teams/domain/genuine-membership";
import { membershipDocId } from "../../teams/domain/team-membership";

/**
 * Genuine-membership gate for the collaborative profile. It uses the same pure decision as the C2 seam
 * (`teams/domain/genuine-membership`) and its own reads, so this feature does not import C2 server code.
 */
export interface GenuineMembershipDeps {
  isSuperadmin?: IsAppAdminDeps["isSuperadmin"];
  reads?: GenuineMembershipReads;
}

function getDefaultReads(): GenuineMembershipReads {
  return {
    async getTeamStatus(teamId) {
      const snapshot = await getFirestoreDb().collection("teams").doc(teamId).get();
      return snapshot.exists ? snapshot.data()?.status : undefined;
    },
    async getMembership(uid, teamId) {
      const snapshot = await getFirestoreDb().collection("teamMemberships").doc(membershipDocId(uid, teamId)).get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
  };
}

export async function requireGenuineMember(
  identity: VerifiedIdentity,
  teamId: string,
  deps: GenuineMembershipDeps = {},
): Promise<RequireGenuineMemberResult> {
  return requireGenuineMemberWith(identity, teamId, deps.reads ?? getDefaultReads());
}

export async function requireTeamAdministrator(
  identity: VerifiedIdentity,
  teamId: string,
  deps: GenuineMembershipDeps = {},
): Promise<RequireTeamAdministratorResult> {
  return requireTeamAdministratorWith(identity, teamId, deps.reads ?? getDefaultReads(), (id) =>
    isAppAdmin(id, { isSuperadmin: deps.isSuperadmin }),
  );
}

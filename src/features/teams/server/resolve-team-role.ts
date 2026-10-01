import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import { isValidTeamStatus } from "../domain/team";
import { isValidMembershipFor, membershipDocId, membershipRoleOf } from "../domain/team-membership";
import {
  authorizeTeamAccess,
  type AuthorizeTeamAccessCollection,
  type AuthorizeTeamAccessDeps,
} from "./authorize-team-access";

const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";

/** A caller's effective authorization role for one team (docs/features/member-identity-and-team-roles/SPEC.md — BR-24). This is a *team authorization role*, never a professional role. */
export type TeamRole = "admin" | "lead" | "member" | "denied";

/** `ok: false` means the decision could not be made — never collapsed into `"denied"`. */
export type ResolveTeamRoleResult =
  | { ok: true; role: TeamRole }
  | { ok: false; error: "read_failed" };

export type ResolveTeamRoleDeps = AuthorizeTeamAccessDeps;

// Same two document reads `authorizeTeamAccess` uses by default; kept here
// (rather than exporting that file's private helper) so `authorize-team-
// access.ts` stays untouched. Only the reads are repeated — every decision
// about them is made by `authorizeTeamAccess` or by the shared domain
// helpers, never re-implemented.
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
 * Resolves a *verified* identity's relationship to one team as
 * `admin | lead | member | denied` (SPEC — BR-24 through BR-28), re-derived
 * from fresh server-side state on every call. The identity must already
 * have been verified by the caller (`verifyIdToken`); nothing the client
 * sends ever decides a role.
 *
 * It **wraps** `authorizeTeamAccess` without changing it: `admin`, `denied`
 * and a failed read pass through verbatim, so app-admin resolution and team
 * lifecycle semantics (nonexistent/malformed team ⇒ denied for everyone,
 * disabled team ⇒ members keep access) have a single definition. An app
 * admin is always `"admin"`, even with a lead membership, and a lead is
 * never an admin. Only for a `member` result does it look further: it
 * re-reads the caller's membership, classifies it with `membershipRoleOf`
 * (exact `"lead"` only, everything else `member`), and returns `"lead"` only
 * while the team's status is exactly `"active"` — a stored lead on a
 * disabled team is a plain `"member"` (BR-27), its role left dormant in
 * storage. If the membership vanished between the two reads the result is
 * `"denied"`; any Firestore read failure is `read_failed`.
 *
 * `authorizeTeamAccess` itself still reports a lead as `"member"`. Nothing in
 * the codebase calls this function yet: lead confers no permission until a
 * later feature explicitly opts in (BR-26, BR-28).
 */
export async function resolveTeamRole(
  identity: VerifiedIdentity,
  teamId: string,
  deps: ResolveTeamRoleDeps = {},
): Promise<ResolveTeamRoleResult> {
  const collection = deps.collection ?? getDefaultCollection();

  const authorized = await authorizeTeamAccess(identity, teamId, { allowList: deps.allowList, collection });
  if (!authorized.ok) {
    return { ok: false, error: "read_failed" };
  }
  if (authorized.access !== "member") {
    return { ok: true, role: authorized.access };
  }

  try {
    const membership = await collection.getMembership(identity.uid, teamId);
    if (!isValidMembershipFor(membership, { uid: identity.uid, teamId })) {
      return { ok: true, role: "denied" };
    }
    if (membershipRoleOf(membership) !== "lead") {
      return { ok: true, role: "member" };
    }

    const status = await collection.getTeamStatus(teamId);
    return { ok: true, role: isValidTeamStatus(status) && status === "active" ? "lead" : "member" };
  } catch {
    return { ok: false, error: "read_failed" };
  }
}

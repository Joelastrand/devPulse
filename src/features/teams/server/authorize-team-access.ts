import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import { isAppAdmin, type IsAppAdminDeps } from "../domain/app-admin";
import { isValidTeamStatus } from "../domain/team";
import { isValidMembershipFor, membershipDocId } from "../domain/team-membership";

const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";

export type TeamAccessLevel = "admin" | "member" | "denied";

/**
 * `ok: false` means the authorization decision itself could not be made
 * (a Firestore read failed) — this is never collapsed into `"denied"`,
 * so a genuine authorization denial stays distinguishable from an
 * infrastructure failure for every caller, present and future.
 */
export type AuthorizeTeamAccessResult =
  | { ok: true; access: TeamAccessLevel }
  | { ok: false; error: "read_failed" };

/**
 * The read seam this operation depends on, satisfied in production by two
 * Firestore document reads and by an in-memory fake in tests. Returns raw,
 * unvalidated field/document data — `authorizeTeamAccess` is responsible
 * for validating it before trusting it as authorization evidence.
 */
export interface AuthorizeTeamAccessCollection {
  /** Raw `status` field of `teams/{teamId}`, or `undefined` if no such document exists. */
  getTeamStatus(teamId: string): Promise<unknown>;
  /** Raw `teamMemberships/{uid}__{teamId}` document data, or `undefined` if it doesn't exist. */
  getMembership(uid: string, teamId: string): Promise<unknown>;
}

function getDefaultCollection(): AuthorizeTeamAccessCollection {
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

export interface AuthorizeTeamAccessDeps {
  allowList?: IsAppAdminDeps["allowList"];
  collection?: AuthorizeTeamAccessCollection;
}

/**
 * The single authorization boundary every protected team-scoped operation
 * must go through (docs/features/team-management/SPEC.md — BR-8, BR-10):
 * never trusts a client-supplied role, membership claim, or team
 * identifier — only the caller's verified identity and server-side
 * Firestore state.
 *
 * A `teamId` that doesn't exist, or whose `status` field is malformed/
 * unrecognized, resolves to `{ok: true, access: "denied"}` for every
 * caller, including an app admin (BR-16) — there is nothing to
 * administer, and a status that can't be trusted must not silently grant
 * access to anyone. An existing, `disabled` team remains `"admin"` for an
 * app admin and `"member"` for an existing member (BR-3); a non-member of
 * a disabled (or nonexistent) team is always `"denied"`.
 *
 * A Firestore read failure while resolving team status or membership is
 * never treated as `"denied"` — it resolves to `{ok: false, error:
 * "read_failed"}` instead, so an infrastructure failure stays
 * distinguishable from a genuine authorization decision (fail-closed
 * either way: the caller must never proceed to protected data on a
 * `read_failed` result).
 */
export async function authorizeTeamAccess(
  identity: VerifiedIdentity,
  teamId: string,
  deps: AuthorizeTeamAccessDeps = {},
): Promise<AuthorizeTeamAccessResult> {
  const collection = deps.collection ?? getDefaultCollection();

  let rawStatus: unknown;
  try {
    rawStatus = await collection.getTeamStatus(teamId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  if (!isValidTeamStatus(rawStatus)) {
    return { ok: true, access: "denied" };
  }

  if (isAppAdmin(identity, { allowList: deps.allowList })) {
    return { ok: true, access: "admin" };
  }

  let rawMembership: unknown;
  try {
    rawMembership = await collection.getMembership(identity.uid, teamId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const isMember = isValidMembershipFor(rawMembership, {
    uid: identity.uid,
    teamId,
  });

  return { ok: true, access: isMember ? "member" : "denied" };
}

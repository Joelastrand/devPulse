import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../domain/app-admin";
import { membershipDocId } from "../domain/team-membership";
import { requireAppAdmin } from "./require-app-admin";

const MEMBERSHIPS_COLLECTION = "teamMemberships";

/**
 * The write seam this operation depends on, satisfied in production by a
 * Firestore document delete and by an in-memory fake in tests.
 */
export interface RemoveMemberCollection {
  remove(uid: string, teamId: string): Promise<void>;
}

function getDefaultCollection(): RemoveMemberCollection {
  return {
    async remove(uid, teamId) {
      await getFirestoreDb()
        .collection(MEMBERSHIPS_COLLECTION)
        .doc(membershipDocId(uid, teamId))
        .delete();
    },
  };
}

export type RemoveTeamMemberResult =
  | { ok: true }
  | { ok: false; error: "unauthenticated" | "forbidden" | "persistence_failed" };

export interface RemoveTeamMemberDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  collection?: RemoveMemberCollection;
}

/**
 * Removes one member's `teamMemberships` document. Only an app admin may
 * call this successfully (docs/features/team-management/SPEC.md — BR-29).
 * Deleting a nonexistent membership succeeds (Firestore's delete is
 * idempotent) — removal is safe to call more than once. Access for the
 * removed `uid` is revoked starting with their very next
 * `authorizeTeamAccess` check (BR-9) — there is no cached authorization
 * state to invalidate.
 */
export async function removeTeamMember(
  idToken: string,
  teamId: string,
  uid: string,
  deps: RemoveTeamMemberDeps = {},
): Promise<RemoveTeamMemberResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const collection = deps.collection ?? getDefaultCollection();

  try {
    await collection.remove(uid, teamId);
    return { ok: true };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

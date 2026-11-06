import "server-only";
import { destroyMembershipForRemoval } from "../../account-erasure/server/membership-destruction-adapter";
import { type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../domain/app-admin";
import { membershipDocId } from "../domain/team-membership";
import { requireAppAdmin } from "./require-app-admin";
import { type AuthRefusal } from "../../auth/server/auth-refusal";
import { writeRefusalFor } from "../../auth/server/erasure-write-fence";

/**
 * The write seam this operation depends on, satisfied in production by a
 * Firestore document delete and by an in-memory fake in tests.
 */
export interface RemoveMemberCollection {
  remove(uid: string, teamId: string): Promise<void>;
}

/**
 * Ordinary removal destroys the membership instance through the lifecycle boundary (TASK-038, owner decision 2026-11-02):
 * the memberRef-dependent references (roadmap owner, participant bindings) are cleared before the membership is deleted, and
 * the delete is conditioned on those references being gone, in one transaction. The removed member's own erasure fence is
 * read in that transaction (BR-4(b)); a fenced member refuses with `erasure_in_progress` and nothing is cleared.
 */
function getDefaultCollection(): RemoveMemberCollection {
  return {
    async remove(uid, teamId) {
      await destroyMembershipForRemoval(uid, membershipDocId(uid, teamId));
    },
  };
}

export type RemoveTeamMemberResult =
  | { ok: true }
  | { ok: false; error: AuthRefusal | "forbidden" | "persistence_failed" | "erasure_in_progress" };

export interface RemoveTeamMemberDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  isSuperadmin?: IsAppAdminDeps["isSuperadmin"];
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
    isSuperadmin: deps.isSuperadmin,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const collection = deps.collection ?? getDefaultCollection();

  try {
    await collection.remove(uid, teamId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }
}

import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../domain/app-admin";
import { accessRequestDocId, readAccessRequestStatusFor } from "../domain/team-access-request";
import { membershipDocId } from "../domain/team-membership";
import { applyMembershipGrant } from "./grant-team-membership";
import { requireAppAdmin } from "./require-app-admin";

const REQUESTS_COLLECTION = "teamAccessRequests";
const MEMBERSHIPS_COLLECTION = "teamMemberships";

export type ApproveOneOutcome = "approved" | "already_approved" | "not_pending" | "not_found";

export interface ApproveAccessRequestCollection {
  /**
   * Transactional read-modify-write spanning the access-request document
   * and the membership document (docs/features/team-management/SPEC.md —
   * BR-27, Edge cases → "Concurrent approval and a duplicate request"):
   * re-reads both documents *inside* the transaction, so two concurrent
   * approvals — or an approval racing a duplicate request/resolution —
   * can never both create a membership or both transition the request.
   * Only a currently-`"pending"` request is approved; an already-
   * `"approved"` request is a no-op (idempotent retry, no membership
   * write attempted — this must never resurrect a since-removed
   * membership); any other status (`"rejected"`, or malformed) is
   * `"not_pending"`, also with no write.
   */
  approveOne(params: {
    uid: string;
    teamId: string;
    resolvedBy: string;
    now: Date;
  }): Promise<ApproveOneOutcome>;
}

function getDefaultCollection(): ApproveAccessRequestCollection {
  const db = getFirestoreDb();
  return {
    async approveOne({ uid, teamId, resolvedBy, now }) {
      const requestRef = db.collection(REQUESTS_COLLECTION).doc(accessRequestDocId(uid, teamId));
      const membershipRef = db
        .collection(MEMBERSHIPS_COLLECTION)
        .doc(membershipDocId(uid, teamId));

      return db.runTransaction(async (tx): Promise<ApproveOneOutcome> => {
        const requestSnap = await tx.get(requestRef);
        if (!requestSnap.exists) {
          return "not_found";
        }

        const status = readAccessRequestStatusFor(requestSnap.data(), { uid, teamId });
        if (status === "approved") {
          return "already_approved";
        }
        if (status !== "pending") {
          return "not_pending";
        }

        const membershipSnap = await tx.get(membershipRef);
        applyMembershipGrant(tx, membershipRef, membershipSnap.exists, {
          uid,
          teamId,
          createdAt: now,
          createdVia: "access_request",
          grantedBy: resolvedBy,
        });
        tx.update(requestRef, { status: "approved", resolvedAt: now, resolvedBy });

        return "approved";
      });
    },
  };
}

export type ApproveAccessRequestResult =
  | { ok: true; outcome: ApproveOneOutcome }
  | { ok: false; error: "unauthenticated" | "forbidden" | "persistence_failed" };

export interface ApproveAccessRequestDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  collection?: ApproveAccessRequestCollection;
}

/**
 * Approves a pending access request (docs/features/team-management/
 * SPEC.md — BR-26, BR-27). Only an app admin may call this successfully.
 * Atomically creates the `uid`-based `teamMemberships` document (via the
 * shared `applyMembershipGrant` primitive, race-safe against a concurrent
 * `resolveInvitations`/`createInvitation` grant for the same uid/team —
 * whichever transaction commits first wins) and transitions the request
 * to `"approved"` with `resolvedAt`/`resolvedBy` set to the approving
 * admin's own `uid` — never derived from any requester-supplied email.
 * Idempotent: approving an already-`"approved"` request is a no-op that
 * never re-attempts a membership write (so a since-removed membership is
 * never silently resurrected by a stale retry); approving a `"rejected"`
 * or nonexistent request is also a no-op, reported via `outcome`, not an
 * error.
 */
export async function approveAccessRequest(
  idToken: string,
  uid: string,
  teamId: string,
  deps: ApproveAccessRequestDeps = {},
): Promise<ApproveAccessRequestResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const collection = deps.collection ?? getDefaultCollection();
  const now = deps.now ?? new Date();

  try {
    const outcome = await collection.approveOne({
      uid,
      teamId,
      resolvedBy: admin.identity.uid,
      now,
    });
    return { ok: true, outcome };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

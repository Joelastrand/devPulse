import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../domain/app-admin";
import { accessRequestDocId, readAccessRequestStatusFor } from "../domain/team-access-request";
import { requireAppAdmin } from "./require-app-admin";

const REQUESTS_COLLECTION = "teamAccessRequests";

export type RejectOneOutcome = "rejected" | "already_rejected" | "not_pending" | "not_found";

export interface RejectAccessRequestCollection {
  /**
   * Transactional read-modify-write on the single deterministic
   * `teamAccessRequests/{uid}__{teamId}` document — re-reads status
   * *inside* the transaction so a rejection racing a concurrent approval
   * can never overwrite an already-`"approved"` request back to
   * `"rejected"` (converges safely: only a currently-`"pending"` request
   * transitions). Never touches `teamMemberships` — rejection creates no
   * membership under any circumstance (BR-27).
   */
  rejectOne(params: {
    uid: string;
    teamId: string;
    resolvedBy: string;
    now: Date;
  }): Promise<RejectOneOutcome>;
}

function getDefaultCollection(): RejectAccessRequestCollection {
  const db = getFirestoreDb();
  return {
    async rejectOne({ uid, teamId, resolvedBy, now }) {
      const requestRef = db.collection(REQUESTS_COLLECTION).doc(accessRequestDocId(uid, teamId));

      return db.runTransaction(async (tx): Promise<RejectOneOutcome> => {
        const requestSnap = await tx.get(requestRef);
        if (!requestSnap.exists) {
          return "not_found";
        }

        const status = readAccessRequestStatusFor(requestSnap.data(), { uid, teamId });
        if (status === "rejected") {
          return "already_rejected";
        }
        if (status !== "pending") {
          return "not_pending";
        }

        tx.update(requestRef, { status: "rejected", resolvedAt: now, resolvedBy });
        return "rejected";
      });
    },
  };
}

export type RejectAccessRequestResult =
  | { ok: true; outcome: RejectOneOutcome }
  | { ok: false; error: "unauthenticated" | "forbidden" | "persistence_failed" };

export interface RejectAccessRequestDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  collection?: RejectAccessRequestCollection;
}

/**
 * Rejects a pending access request (docs/features/team-management/
 * SPEC.md — BR-26, BR-27). Only an app admin may call this successfully.
 * Never creates a `teamMemberships` document under any outcome. Sets
 * `resolvedAt`/`resolvedBy` (the rejecting admin's own `uid`) only when
 * transitioning a genuinely `"pending"` request. Idempotent: rejecting an
 * already-`"rejected"` request is a no-op; rejecting an `"approved"` or
 * nonexistent request is also a no-op (`outcome`, not an error) — a
 * rejection can never undo a completed approval.
 */
export async function rejectAccessRequest(
  idToken: string,
  uid: string,
  teamId: string,
  deps: RejectAccessRequestDeps = {},
): Promise<RejectAccessRequestResult> {
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
    const outcome = await collection.rejectOne({
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

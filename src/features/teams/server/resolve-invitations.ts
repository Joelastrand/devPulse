import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import { normalizeEmail } from "../domain/normalize-email";
import { invitationDocId, isValidPendingInvitationFor } from "../domain/team-invitation";
import { membershipDocId } from "../domain/team-membership";
import { applyMembershipGrant } from "./grant-team-membership";

const MEMBERSHIPS_COLLECTION = "teamMemberships";
const INVITATIONS_COLLECTION = "teamInvitations";

/** Outcome of attempting to resolve exactly one candidate invitation. */
export type ResolveOneOutcome = "membership_created" | "already_member" | "no_longer_pending";

/**
 * The transactional write seam this operation depends on, satisfied in
 * production by a single Firestore transaction (`resolveOne`) and by an
 * in-memory fake in tests. `resolveOne` re-checks the invitation's status
 * and the membership's existence atomically, so two concurrent resolution
 * attempts for the same (email, teamId) can never both create a
 * membership or both mark the same invitation resolved (requirement 6:
 * "transactions or deterministic writes ... to avoid duplicate
 * membership/invitation races"). The membership write itself goes through
 * `applyMembershipGrant` — the same decide-and-write primitive
 * `create-invitation.ts`'s immediate-grant path uses via its own
 * transaction — so a `createInvitation` call and a `resolveInvitations`
 * call racing for the same (uid, teamId) can never both win: whichever
 * transaction commits first is authoritative, the other observes the
 * membership as already existing and never overwrites its `grantedBy`.
 */
export interface ResolveInvitationsCollection {
  /** Every raw `teamInvitations` document for this email, regardless of status. */
  listRawForEmail(email: string): Promise<unknown[]>;
  resolveOne(params: {
    teamId: string;
    email: string;
    uid: string;
    now: Date;
  }): Promise<ResolveOneOutcome>;
}

function getDefaultCollection(): ResolveInvitationsCollection {
  const db = getFirestoreDb();
  return {
    async listRawForEmail(email) {
      const snapshot = await db
        .collection(INVITATIONS_COLLECTION)
        .where("email", "==", email)
        .where("status", "==", "pending")
        .get();
      return snapshot.docs.map((doc) => doc.data());
    },
    async resolveOne({ teamId, email, uid, now }) {
      const invitationRef = db.collection(INVITATIONS_COLLECTION).doc(invitationDocId(teamId, email));
      const membershipRef = db.collection(MEMBERSHIPS_COLLECTION).doc(membershipDocId(uid, teamId));

      return db.runTransaction(async (tx): Promise<ResolveOneOutcome> => {
        const [invitationSnap, membershipSnap] = await Promise.all([
          tx.get(invitationRef),
          tx.get(membershipRef),
        ]);

        if (membershipSnap.exists) {
          if (
            invitationSnap.exists &&
            isValidPendingInvitationFor(invitationSnap.data(), { teamId, email })
          ) {
            tx.update(invitationRef, {
              status: "accepted",
              updatedAt: now,
              resolvedAt: now,
              resolvedUid: uid,
            });
          }
          return "already_member";
        }

        if (!invitationSnap.exists) {
          return "no_longer_pending";
        }

        const invitationData = invitationSnap.data();
        if (!isValidPendingInvitationFor(invitationData, { teamId, email })) {
          return "no_longer_pending";
        }

        const grantOutcome = applyMembershipGrant(tx, membershipRef, membershipSnap.exists, {
          uid,
          teamId,
          createdAt: now,
          createdVia: "invitation",
          grantedBy: invitationData.invitedBy,
        });
        tx.update(invitationRef, {
          status: "accepted",
          updatedAt: now,
          resolvedAt: now,
          resolvedUid: uid,
        });

        return grantOutcome === "created" ? "membership_created" : "already_member";
      });
    },
  };
}

export type ResolveInvitationsResult =
  | { ok: true; membershipsCreated: number }
  | { ok: false; error: "read_failed" | "persistence_failed" };

export interface ResolveInvitationsDeps {
  now?: Date;
  collection?: ResolveInvitationsCollection;
}

/**
 * Resolves every pending invitation matching the caller's currently
 * verified email into a `teamMemberships` document
 * (docs/features/team-management/SPEC.md — BR-20). Meant to be composed
 * into any team-scoped request path (TASK-007/TASK-008) using the
 * identity that request has already verified — never re-verifies a token
 * itself.
 *
 * An unverified email never triggers resolution (returns immediately with
 * zero memberships created, not an error) — an unverified matching email
 * must never grant access. Exact-match normalization means a different
 * user's invitation, or one for the caller's *previous* email, is never
 * touched (BR-20's "matching ... email" is exact, not fuzzy). Already
 * holding membership is idempotent: a stale pending invitation is simply
 * marked resolved without creating a duplicate. A canceled invitation is
 * never resolved, because only `"pending"` invitations are considered.
 * Calling this twice for the same caller creates at most one membership
 * per invitation — the second call finds no remaining pending invitation
 * for the (team, email) pair it already resolved.
 */
export async function resolveInvitations(
  identity: VerifiedIdentity,
  deps: ResolveInvitationsDeps = {},
): Promise<ResolveInvitationsResult> {
  if (!identity.emailVerified) {
    return { ok: true, membershipsCreated: 0 };
  }

  const email = normalizeEmail(identity.email);
  const collection = deps.collection ?? getDefaultCollection();
  const now = deps.now ?? new Date();

  let rawInvitations: unknown[];
  try {
    rawInvitations = await collection.listRawForEmail(email);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const candidateTeamIds = new Set<string>();
  for (const raw of rawInvitations) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const teamId = (raw as Record<string, unknown>).teamId;
    if (typeof teamId === "string" && teamId.length > 0) {
      candidateTeamIds.add(teamId);
    }
  }

  let membershipsCreated = 0;
  for (const teamId of candidateTeamIds) {
    let outcome: ResolveOneOutcome;
    try {
      outcome = await collection.resolveOne({ teamId, email, uid: identity.uid, now });
    } catch {
      return { ok: false, error: "persistence_failed" };
    }
    if (outcome === "membership_created") {
      membershipsCreated += 1;
    }
  }

  return { ok: true, membershipsCreated };
}

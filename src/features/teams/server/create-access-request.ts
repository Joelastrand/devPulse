import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import {
  verifyIdToken,
  type VerifyIdTokenDeps,
} from "../../auth/server/verify-identity";
import {
  authorizeTeamAccess,
  type AuthorizeTeamAccessDeps,
} from "./authorize-team-access";
import { accessRequestDocId, readAccessRequestStatusFor } from "../domain/team-access-request";
import { membershipDocId } from "../domain/team-membership";

const TEAMS_COLLECTION = "teams";
const REQUESTS_COLLECTION = "teamAccessRequests";
const MEMBERSHIPS_COLLECTION = "teamMemberships";

export interface CreateAccessRequestTeamsCollection {
  /** Raw `status` field of `teams/{teamId}`, or `undefined` if no such document exists. */
  getStatus(teamId: string): Promise<unknown>;
}

export type CreateOrResetOutcome = "created" | "already_pending" | "already_authorized";

export interface CreateAccessRequestCollection {
  /**
   * Transactional read-modify-write spanning the single deterministic
   * `teamAccessRequests/{uid}__{teamId}` document *and* the
   * `teamMemberships/{uid}__{teamId}` document (docs/features/
   * team-management/SPEC.md — Edge cases → "Concurrent approval and a
   * duplicate request for the same pending access request"): re-reads
   * both *inside* the transaction. If membership now exists — even if it
   * was granted by a concurrent approval that committed after this
   * function's own (non-transactional) `authorizeTeamAccess` pre-check
   * ran — this returns `"already_authorized"` and never resets the
   * request document, so a duplicate/racing create call can never
   * overwrite a just-completed approval's `"approved"` status back to
   * `"pending"` (no lost update). Otherwise: re-reads status and only
   * writes when it isn't already `"pending"`, so two concurrent calls for
   * the same (uid, teamId) can never both create a request (BR-24), and a
   * previously `"rejected"` or `"approved"`-but-no-longer-a-member request
   * resets to `"pending"` (BR-25).
   */
  createOrReset(params: { uid: string; teamId: string; now: Date }): Promise<CreateOrResetOutcome>;
}

function getDefaultTeamsCollection(): CreateAccessRequestTeamsCollection {
  return {
    async getStatus(teamId) {
      const snapshot = await getFirestoreDb().collection(TEAMS_COLLECTION).doc(teamId).get();
      return snapshot.exists ? snapshot.data()?.status : undefined;
    },
  };
}

function getDefaultCollection(): CreateAccessRequestCollection {
  const db = getFirestoreDb();
  return {
    async createOrReset({ uid, teamId, now }) {
      const ref = db.collection(REQUESTS_COLLECTION).doc(accessRequestDocId(uid, teamId));
      const membershipRef = db
        .collection(MEMBERSHIPS_COLLECTION)
        .doc(membershipDocId(uid, teamId));

      return db.runTransaction(async (tx): Promise<CreateOrResetOutcome> => {
        const [snapshot, membershipSnap] = await Promise.all([
          tx.get(ref),
          tx.get(membershipRef),
        ]);

        if (membershipSnap.exists) {
          return "already_authorized";
        }

        if (snapshot.exists) {
          const status = readAccessRequestStatusFor(snapshot.data(), { uid, teamId });
          if (status === "pending") {
            return "already_pending";
          }
        }
        tx.set(ref, { teamId, uid, status: "pending", createdAt: now });
        return "created";
      });
    },
  };
}

export type CreateAccessRequestResult =
  | { ok: true; outcome: "created" | "already_pending" | "already_authorized" }
  | {
      ok: false;
      error: "unauthenticated" | "unverified" | "team_disabled" | "read_failed" | "persistence_failed";
    };

export interface CreateAccessRequestDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: AuthorizeTeamAccessDeps["allowList"];
  authorizeCollection?: AuthorizeTeamAccessDeps["collection"];
  teamsCollection?: CreateAccessRequestTeamsCollection;
  collection?: CreateAccessRequestCollection;
}

/**
 * Submits an access request for a team on behalf of the caller's own
 * verified identity (docs/features/team-management/SPEC.md — BR-23
 * through BR-25, BR-28). Identity always comes from a revocation-checked
 * `verifyIdToken` — never a client-supplied uid/email.
 *
 * A caller already authorized as `"admin"` or `"member"` (via
 * `authorizeTeamAccess`, reused unchanged) never creates a request —
 * BR-28's "rejected as a no-op" (`already_authorized`). Only once access
 * is `"denied"` does this proceed to check `disabled` team status
 * explicitly for a distinct rejection (SPEC → Edge cases → "Access
 * request or invitation targeting a disabled team"); a nonexistent or
 * malformed team status is deliberately treated identically to an
 * existing-but-unrelated `active` team from this point on — both proceed
 * to create/reset the request the same way, so no distinguishing
 * existence signal is ever returned for a `teamId` the caller has no
 * relationship to (SPEC → Edge cases → "Requesting access to a
 * nonexistent teamId").
 */
export async function createAccessRequest(
  idToken: string,
  teamId: string,
  deps: CreateAccessRequestDeps = {},
): Promise<CreateAccessRequestResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) {
    return { ok: false, error: "unauthenticated" };
  }
  if (!verified.identity.emailVerified) {
    return { ok: false, error: "unverified" };
  }

  const authResult = await authorizeTeamAccess(verified.identity, teamId, {
    allowList: deps.allowList,
    collection: deps.authorizeCollection,
  });
  if (!authResult.ok) {
    return { ok: false, error: "read_failed" };
  }
  if (authResult.access !== "denied") {
    return { ok: true, outcome: "already_authorized" };
  }

  const teamsCollection = deps.teamsCollection ?? getDefaultTeamsCollection();
  let rawStatus: unknown;
  try {
    rawStatus = await teamsCollection.getStatus(teamId);
  } catch {
    return { ok: false, error: "read_failed" };
  }
  if (rawStatus === "disabled") {
    return { ok: false, error: "team_disabled" };
  }

  const collection = deps.collection ?? getDefaultCollection();
  const now = deps.now ?? new Date();

  try {
    const outcome = await collection.createOrReset({ uid: verified.identity.uid, teamId, now });
    return { ok: true, outcome };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

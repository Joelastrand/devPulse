import "server-only";
import { getAdminAuth, getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../domain/app-admin";
import { normalizeEmail } from "../domain/normalize-email";
import { isValidTeamStatus } from "../domain/team";
import { isValidMembershipFor, membershipDocId } from "../domain/team-membership";
import {
  invitationDocId,
  readInvitationStatusFor,
  type TeamInvitationRecord,
} from "../domain/team-invitation";
import {
  grantTeamMembership,
  type GrantTeamMembershipCollection,
  type GrantTeamMembershipOutcome,
} from "./grant-team-membership";
import { requireAppAdmin } from "./require-app-admin";

const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";
const INVITATIONS_COLLECTION = "teamInvitations";

export interface CreateInvitationTeamsCollection {
  /** Raw `status` field of `teams/{teamId}`, or `undefined` if no such document exists. */
  getStatus(teamId: string): Promise<unknown>;
}

export interface CreateInvitationMembershipsCollection {
  /** Raw `teamMemberships/{uid}__{teamId}` document data, or `undefined` if it doesn't exist. */
  get(uid: string, teamId: string): Promise<unknown>;
}

export interface CreateInvitationInvitationsCollection {
  /** Raw `teamInvitations/{teamId}__{email}` document data, or `undefined` if it doesn't exist. */
  get(teamId: string, email: string): Promise<unknown>;
  /** Full overwrite with the deterministic id — always a complete, valid record. */
  setPending(record: TeamInvitationRecord): Promise<void>;
  /** Transitions an existing `"pending"` record to `"accepted"`. */
  markAccepted(teamId: string, email: string, resolvedUid: string, now: Date): Promise<void>;
}

export type GetUserByEmail = (
  email: string,
) => Promise<{ uid: string; emailVerified: boolean } | null>;

function getDefaultTeamsCollection(): CreateInvitationTeamsCollection {
  return {
    async getStatus(teamId) {
      const snapshot = await getFirestoreDb().collection(TEAMS_COLLECTION).doc(teamId).get();
      return snapshot.exists ? snapshot.data()?.status : undefined;
    },
  };
}

function getDefaultMembershipsCollection(): CreateInvitationMembershipsCollection {
  return {
    async get(uid, teamId) {
      const snapshot = await getFirestoreDb()
        .collection(MEMBERSHIPS_COLLECTION)
        .doc(membershipDocId(uid, teamId))
        .get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
  };
}

function getDefaultInvitationsCollection(): CreateInvitationInvitationsCollection {
  return {
    async get(teamId, email) {
      const snapshot = await getFirestoreDb()
        .collection(INVITATIONS_COLLECTION)
        .doc(invitationDocId(teamId, email))
        .get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
    async setPending(record) {
      await getFirestoreDb()
        .collection(INVITATIONS_COLLECTION)
        .doc(invitationDocId(record.teamId, record.email))
        .set(record);
    },
    async markAccepted(teamId, email, resolvedUid, now) {
      await getFirestoreDb()
        .collection(INVITATIONS_COLLECTION)
        .doc(invitationDocId(teamId, email))
        .update({ status: "accepted", updatedAt: now, resolvedAt: now, resolvedUid });
    },
  };
}

/**
 * Transitions a matching `"pending"` invitation to `"accepted"` once the
 * caller has confirmed membership exists (or was just created) for the
 * given (teamId, email) — closes the gap where an earlier pending
 * invitation would otherwise be left stale/misleading after `createInvitation`
 * grants (or discovers) membership through this same email
 * (docs/features/team-management/SPEC.md — BR-18, BR-30). A no-op for a
 * missing, already-`"accepted"`, or `"canceled"` invitation: only a
 * currently-pending record is ever transitioned here — a `"canceled"`
 * invitation is never silently revived into `"accepted"` (BR-21), and an
 * already-`"accepted"` record is left untouched (no regression).
 */
async function acceptMatchingPendingInvitation(
  invitationsCollection: CreateInvitationInvitationsCollection,
  params: { teamId: string; email: string; uid: string; now: Date },
): Promise<void> {
  const raw = await invitationsCollection.get(params.teamId, params.email);
  const status = readInvitationStatusFor(raw, { teamId: params.teamId, email: params.email });
  if (status === "pending") {
    await invitationsCollection.markAccepted(params.teamId, params.email, params.uid, params.now);
  }
}

function isUserNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "auth/user-not-found"
  );
}

async function defaultGetUserByEmail(
  email: string,
): ReturnType<GetUserByEmail> {
  try {
    const user = await getAdminAuth().getUserByEmail(email);
    return { uid: user.uid, emailVerified: user.emailVerified === true };
  } catch (error) {
    if (isUserNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

export type CreateInvitationResult =
  | {
      ok: true;
      outcome:
        | "membership_created"
        | "invitation_created"
        | "invitation_already_pending"
        | "already_member";
    }
  | {
      ok: false;
      error:
        | "unauthenticated"
        | "forbidden"
        | "invalid_email"
        | "team_not_found"
        | "team_disabled"
        | "lookup_failed"
        | "persistence_failed";
    };

export interface CreateInvitationDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  teamsCollection?: CreateInvitationTeamsCollection;
  membershipsCollection?: CreateInvitationMembershipsCollection;
  invitationsCollection?: CreateInvitationInvitationsCollection;
  getUserByEmail?: GetUserByEmail;
  grantMembershipCollection?: GrantTeamMembershipCollection;
}

/**
 * Invites an email to a team (docs/features/team-management/SPEC.md —
 * BR-17 through BR-22). Only an app admin may call this successfully.
 * Fails closed if the target team doesn't exist or is `disabled` — never
 * creates or revives a team. If the email already belongs to a
 * Firebase-verified account, membership is granted immediately via
 * `grantTeamMembership`'s atomic check-and-set (idempotent if it already
 * exists, rejected as a no-op if the caller re-invites an existing member —
 * BR-22); an unverified matching account, or no account at all, results in
 * a pending `teamInvitations` record instead, itself idempotent against a
 * second invite while one is already pending (BR-19).
 *
 * Whenever this resolves to an existing or newly-created membership (the
 * `already_member` and `membership_created` outcomes), any matching
 * `"pending"` `teamInvitations` record for this exact (teamId, email) is
 * transitioned to `"accepted"` (`acceptMatchingPendingInvitation`) — this
 * closes the gap where an earlier pending invitation would otherwise be
 * left stale/misleading once its target already has (or just received)
 * membership. A missing, already-`"accepted"`, or `"canceled"` invitation
 * is left untouched: no new record is created purely to represent this
 * grant (BR-18's "no pending state" plus data minimization — nothing else
 * needs an invitation record once membership itself is the durable grant),
 * and a `"canceled"` record is never silently revived (BR-21).
 */
export async function createInvitation(
  idToken: string,
  teamId: string,
  emailInput: unknown,
  deps: CreateInvitationDeps = {},
): Promise<CreateInvitationResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  if (typeof emailInput !== "string") {
    return { ok: false, error: "invalid_email" };
  }
  const email = normalizeEmail(emailInput);
  if (email.length === 0) {
    return { ok: false, error: "invalid_email" };
  }

  const teamsCollection = deps.teamsCollection ?? getDefaultTeamsCollection();
  let rawStatus: unknown;
  try {
    rawStatus = await teamsCollection.getStatus(teamId);
  } catch {
    return { ok: false, error: "lookup_failed" };
  }

  if (!isValidTeamStatus(rawStatus)) {
    return { ok: false, error: "team_not_found" };
  }
  if (rawStatus === "disabled") {
    return { ok: false, error: "team_disabled" };
  }

  const getUserByEmail = deps.getUserByEmail ?? defaultGetUserByEmail;
  let account: { uid: string; emailVerified: boolean } | null;
  try {
    account = await getUserByEmail(email);
  } catch {
    return { ok: false, error: "lookup_failed" };
  }

  const membershipsCollection =
    deps.membershipsCollection ?? getDefaultMembershipsCollection();
  const invitationsCollection =
    deps.invitationsCollection ?? getDefaultInvitationsCollection();
  const now = deps.now ?? new Date();

  if (account) {
    let rawMembership: unknown;
    try {
      rawMembership = await membershipsCollection.get(account.uid, teamId);
    } catch {
      return { ok: false, error: "lookup_failed" };
    }

    if (isValidMembershipFor(rawMembership, { uid: account.uid, teamId })) {
      try {
        await acceptMatchingPendingInvitation(invitationsCollection, {
          teamId,
          email,
          uid: account.uid,
          now,
        });
      } catch {
        return { ok: false, error: "persistence_failed" };
      }
      return { ok: true, outcome: "already_member" };
    }

    if (account.emailVerified) {
      let grantOutcome: GrantTeamMembershipOutcome;
      try {
        grantOutcome = await grantTeamMembership(
          {
            uid: account.uid,
            teamId,
            createdAt: now,
            createdVia: "invitation",
            grantedBy: admin.identity.uid,
          },
          { collection: deps.grantMembershipCollection },
        );
      } catch {
        return { ok: false, error: "persistence_failed" };
      }

      try {
        await acceptMatchingPendingInvitation(invitationsCollection, {
          teamId,
          email,
          uid: account.uid,
          now,
        });
      } catch {
        return { ok: false, error: "persistence_failed" };
      }

      return {
        ok: true,
        outcome: grantOutcome === "created" ? "membership_created" : "already_member",
      };
    }
    // Account exists but isn't verified yet — fall through to the pending
    // invitation path below so it can be resolved later (BR-20).
  }

  let rawInvitation: unknown;
  try {
    rawInvitation = await invitationsCollection.get(teamId, email);
  } catch {
    return { ok: false, error: "lookup_failed" };
  }

  const existingStatus = readInvitationStatusFor(rawInvitation, { teamId, email });
  if (existingStatus === "pending") {
    return { ok: true, outcome: "invitation_already_pending" };
  }

  try {
    await invitationsCollection.setPending({
      teamId,
      email,
      status: "pending",
      invitedBy: admin.identity.uid,
      createdAt: now,
      updatedAt: now,
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  return { ok: true, outcome: "invitation_created" };
}

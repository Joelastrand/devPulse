import "server-only";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { generateMemberRef } from "../domain/member-ref";
import { membershipDocId, type MembershipSource } from "../domain/team-membership";

const MEMBERSHIPS_COLLECTION = "teamMemberships";

export type GrantTeamMembershipOutcome = "created" | "already_member";

/** The `teamMemberships` document shape this helper writes. */
export interface MembershipGrantRecord {
  uid: string;
  teamId: string;
  createdAt: Date;
  createdVia: MembershipSource;
  grantedBy: string;
}

/**
 * The shared atomic decide-and-write step used by every path that grants
 * team membership (`create-invitation.ts`'s immediate-grant path,
 * `resolve-invitations.ts`'s `resolveOne`): given a membership document's
 * existence as already read *inside* a transaction, creates it only if
 * absent. Because every caller runs this inside a Firestore transaction
 * against the same deterministic membership doc id, two concurrent grant
 * attempts for the same (uid, teamId) can never both write — whichever
 * transaction commits first is authoritative (its `grantedBy` sticks);
 * Firestore's optimistic concurrency forces the other to retry, re-observe
 * the document as existing, and return `"already_member"` without
 * overwriting it. This is what makes grant attribution deterministic
 * (first-committer-wins) rather than a last-write-wins race between
 * `createInvitation` and `resolveInvitations`.
 *
 * A newly created membership also receives a fresh opaque `memberRef`
 * (docs/features/team-skill-planning/SPEC.md — BR-1, BR-2). An existing
 * membership is never written, so its ref (or the absence of one on a legacy
 * document) is left exactly as it was — backfilling legacy documents is an
 * explicit admin operation, not a side effect of a grant. Removal deletes the
 * document, so a later rejoin runs this path again and gets a new ref.
 */
export function applyMembershipGrant(
  tx: Transaction,
  membershipRef: DocumentReference,
  membershipExists: boolean,
  record: MembershipGrantRecord,
): GrantTeamMembershipOutcome {
  if (membershipExists) {
    return "already_member";
  }
  tx.set(membershipRef, { ...record, memberRef: generateMemberRef() });
  return "created";
}

export interface GrantTeamMembershipCollection {
  runGrant(record: MembershipGrantRecord): Promise<GrantTeamMembershipOutcome>;
}

function getDefaultCollection(): GrantTeamMembershipCollection {
  const db = getFirestoreDb();
  return {
    async runGrant(record) {
      const ref = db
        .collection(MEMBERSHIPS_COLLECTION)
        .doc(membershipDocId(record.uid, record.teamId));
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        return applyMembershipGrant(tx, ref, snapshot.exists, record);
      });
    },
  };
}

export interface GrantTeamMembershipDeps {
  collection?: GrantTeamMembershipCollection;
}

/**
 * Standalone entry point for a caller that only needs the membership write
 * itself to be atomic (`create-invitation.ts`'s immediate-grant path) —
 * opens a dedicated single-document transaction around
 * `applyMembershipGrant`. `resolve-invitations.ts`'s `resolveOne` instead
 * calls `applyMembershipGrant` directly inside its own larger transaction,
 * which also needs to touch the invitation document atomically alongside
 * the membership write — both paths end up using the exact same
 * check-and-set decision, just under two different transaction scopes.
 */
export async function grantTeamMembership(
  record: MembershipGrantRecord,
  deps: GrantTeamMembershipDeps = {},
): Promise<GrantTeamMembershipOutcome> {
  const collection = deps.collection ?? getDefaultCollection();
  return collection.runGrant(record);
}

import "server-only";
import { FieldPath } from "firebase-admin/firestore";
import { invitationBelongsToErasedPerson } from "./invitation-match";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { MembershipErasurePort, MembershipTransaction } from "./membership-erasure";
import type { InvitationTransaction, InvitationsErasurePort } from "./invitations-erasure";

/**
 * Production Admin SDK adapters for the team-owned erasure steps: memberships (I-9, A-5) and invitations and access requests
 * (I-10, I-11, A-9, A-10) (TASK-038).
 *
 * Invitation matching by document id: a stored id has the shape `teamId__normalizedEmail`, which Firestore cannot filter by
 * suffix. The adapter therefore also scans the invitation document ids (keys only, no field data) and keeps those ending in
 * `__${normalizedEmail}`. Cost, recorded in VERIFICATION.md: one keys-only read of the whole `teamInvitations` collection per
 * `invitationIdsFor` call. It is correct and idempotent, and it does not invent a `normalizedEmail` field.
 */

const MEMBERSHIPS = "teamMemberships";
const ACCESS_REQUESTS = "teamAccessRequests";
const ROADMAP_ITEMS = "roadmapItems";
const TEAM_SYSTEMS = "teamSystems";
const INVITATIONS = "teamInvitations";
const PREFIX_END = "";

/** The string entries of a stored ref list. A system matched by the array query always carries an array. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function assertUidSegment(uid: string): void {
  if (uid.length === 0 || uid.includes("/")) throw new Error("erasure adapter: invalid uid segment");
}


export function createMembershipPort(): MembershipErasurePort {
  return {
    async runTransaction<T>(work: (tx: MembershipTransaction) => Promise<T>): Promise<T> {
      const db = getFirestoreDb();
      return db.runTransaction((tx) =>
        work({
          async getMembership(membershipId) {
            const snapshot = await tx.get(db.collection(MEMBERSHIPS).doc(membershipId));
            return snapshot.exists ? snapshot.data() : undefined;
          },
          async roadmapItemIdsOwnedBy(teamId, memberRef, limit) {
            // A transactional query: the ownerRef list is read in the same transaction as the membership delete.
            const snapshot = await tx.get(
              db.collection(ROADMAP_ITEMS).where("teamId", "==", teamId).where("ownerRef", "==", memberRef).limit(limit),
            );
            return snapshot.docs.map((doc) => doc.id);
          },
          clearRoadmapOwnerRef(itemId) {
            tx.update(db.collection(ROADMAP_ITEMS).doc(itemId), { ownerRef: null });
          },
          async systemsKnowingMemberRef(teamId, memberRef, limit) {
            // A-14: transactional, so a system that gains this ref concurrently conflicts with the membership delete.
            const snapshot = await tx.get(
              db
                .collection(TEAM_SYSTEMS)
                .where("teamId", "==", teamId)
                .where("knowledgeMemberRefs", "array-contains", memberRef)
                .limit(limit),
            );
            return snapshot.docs.map((doc) => ({ systemId: doc.id, knowledgeMemberRefs: stringList(doc.data()?.knowledgeMemberRefs) }));
          },
          setKnowledgeMemberRefs(systemId, knowledgeMemberRefs) {
            // Writes the filtered list computed by the step. Only this field changes; a retry recomputes from current data.
            tx.update(db.collection(TEAM_SYSTEMS).doc(systemId), { knowledgeMemberRefs });
          },
          async participationIdsOf(teamId, memberRef, limit) {
            // A-15: transactional, so a participation written concurrently conflicts with the membership delete.
            const snapshot = await tx.get(
              db.collection("teamProjectParticipations").where("teamId", "==", teamId).where("memberRef", "==", memberRef).limit(limit),
            );
            return snapshot.docs.map((doc) => doc.id);
          },
          deleteParticipation(participationId) {
            tx.delete(db.collection("teamProjectParticipations").doc(participationId));
          },
          deleteMembership(membershipId) {
            tx.delete(db.collection(MEMBERSHIPS).doc(membershipId));
          },
        }),
      );
    },
    async membershipIdsOf(uid, limit) {
      assertUidSegment(uid);
      const db = getFirestoreDb();
      const byField = await db.collection(MEMBERSHIPS).where("uid", "==", uid).select().limit(limit).get();
      // A legacy document (no uid field) belongs to the uid only by its own id prefix. Documents with another uid are
      // excluded here, so a foreign id that merely shares the prefix cannot block the step forever.
      const byPrefix = await db.collection(MEMBERSHIPS).where(FieldPath.documentId(), ">=", `${uid}__`)
        .where(FieldPath.documentId(), "<", `${uid}__${PREFIX_END}`).limit(limit).get();
      const legacy = byPrefix.docs.filter((doc) => {
        const data = doc.data() as Record<string, unknown> | undefined;
        return data?.uid === undefined;
      });
      return [...new Set([...byField.docs.map((doc) => doc.id), ...legacy.map((doc) => doc.id)])].slice(0, limit);
    },
  };
}

export function createInvitationsPort(): InvitationsErasurePort {
  return {
    async runTransaction<T>(work: (tx: InvitationTransaction) => Promise<T>): Promise<T> {
      const db = getFirestoreDb();
      return db.runTransaction((tx) =>
        work({
          async getAccessRequest(id) {
            const snapshot = await tx.get(db.collection(ACCESS_REQUESTS).doc(id));
            return snapshot.exists ? snapshot.data() : undefined;
          },
          async getInvitation(id) {
            const snapshot = await tx.get(db.collection(INVITATIONS).doc(id));
            return snapshot.exists ? snapshot.data() : undefined;
          },
          deleteAccessRequest(id) {
            tx.delete(db.collection(ACCESS_REQUESTS).doc(id));
          },
          deleteInvitation(id) {
            tx.delete(db.collection(INVITATIONS).doc(id));
          },
          clearAccessRequestResolvedBy(id) {
            tx.update(db.collection(ACCESS_REQUESTS).doc(id), { resolvedBy: null });
          },
          clearInvitationInvitedBy(id) {
            tx.update(db.collection(INVITATIONS).doc(id), { invitedBy: null });
          },
        }),
      );
    },
    async accessRequestIdsFor(uid, limit) {
      assertUidSegment(uid);
      const db = getFirestoreDb();
      const byField = await db.collection(ACCESS_REQUESTS).where("uid", "==", uid).select().limit(limit).get();
      const byPrefix = await db
        .collection("teamAccessRequests")
        .where(FieldPath.documentId(), ">=", `${uid}__`)
        .where(FieldPath.documentId(), "<", `${uid}__${PREFIX_END}`)
        .select()
        .limit(limit)
        .get();
      return [...new Set([...byField.docs.map((doc) => doc.id), ...byPrefix.docs.map((doc) => doc.id)])].slice(0, limit);
    },
    async invitationIdsFor(normalizedEmail, uid, limit) {
      assertUidSegment(uid);
      const db = getFirestoreDb();
      const byEmail = await db.collection(INVITATIONS).where("email", "==", normalizedEmail).select().limit(limit).get();
      const byResolved = await db.collection(INVITATIONS).where("resolvedUid", "==", uid).select().limit(limit).get();
      // Full documents, not keys only: ownership needs the stored e-mail and teamId (invitation-match.ts). The read is bounded
      // by the collection size; see the module note. A suffix match with a different stored e-mail is not returned.
      const all = await db.collection(INVITATIONS).get();
      const byId = all.docs
        .filter((doc) => invitationBelongsToErasedPerson(doc.id, doc.data() as Record<string, unknown>, normalizedEmail, uid))
        .map((doc) => doc.id);
      return [...new Set([...byEmail.docs, ...byResolved.docs].map((doc) => doc.id).concat(byId))].slice(0, limit);
    },
    async accessRequestIdsResolvedBy(uid, limit) {
      assertUidSegment(uid);
      const snapshot = await getFirestoreDb().collection(ACCESS_REQUESTS).where("resolvedBy", "==", uid).select().limit(limit).get();
      return snapshot.docs.map((doc) => doc.id);
    },
    async invitationIdsInvitedBy(uid, limit) {
      assertUidSegment(uid);
      const snapshot = await getFirestoreDb().collection(INVITATIONS).where("invitedBy", "==", uid).select().limit(limit).get();
      return snapshot.docs.map((doc) => doc.id);
    },
  };
}

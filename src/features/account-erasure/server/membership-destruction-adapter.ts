
import { issueErasureOwnerCleanupCapability } from "../../development-conversations/server/erasure-owner-cleanup-capability";
import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { assertNoErasureRecordInTransaction } from "../../auth/server/erasure-write-fence";
import { getDefaultConversationStore } from "../../development-conversations/server/conversation-store";
import { decryptForClassification, encodeContent, probeKey } from "../../development-conversations/server/content-codec";
import type { MembershipDestructionFinalTransaction, MembershipDestructionPort } from "./membership-destruction";
import { destroyMembershipInstance } from "./membership-destruction";
import { createParticipantBindingDiscovery, parseOwnedConversationPath } from "./erasure-adapters-conversations";

/**
 * Production adapter and entry point for destroying one membership instance (TASK-038 owner decision 2026-11-02). It is used by
 * the erasure path and by ordinary admin `removeTeamMember`. Every collection and field name is a literal here. Paths are built
 * from the membership document id and the stored memberRef, and no uid, e-mail or memberRef is logged or returned.
 */

const MEMBERSHIPS = "teamMemberships";
const ROADMAP_ITEMS = "roadmapItems";
const CONVERSATIONS = "conversations";
const TEAM_SYSTEMS = "teamSystems";

/** The string entries of a stored ref list. A system matched by the array query always carries an array. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function membershipAdapterPort(): MembershipDestructionPort {
  const db = getFirestoreDb();
  return {
    async assertNoErasureRecord(uid) {
      await db.runTransaction((tx) => assertNoErasureRecordInTransaction(db, tx, uid));
    },
    async readMembership(membershipId) {
      const snapshot = await db.collection(MEMBERSHIPS).doc(membershipId).get();
      return snapshot.exists ? (snapshot.data() as Record<string, unknown>) : undefined;
    },
    async boundConversations(memberRef, limit) {
      const snapshot = await db
        .collectionGroup(CONVERSATIONS)
        .where("participantMemberRef", "==", memberRef)
        .select()
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) => parseOwnedConversationPath(doc.ref.path));
    },
    async runFinalTransaction<T>(work: (tx: MembershipDestructionFinalTransaction) => Promise<T>): Promise<T> {
      return db.runTransaction((tx) =>
        work({
          // Same transaction as the membership read and delete below, so a record created before commit fails the commit.
          assertNoErasureRecord(uid) {
            return assertNoErasureRecordInTransaction(db, tx, uid);
          },
          async getMembership(membershipId) {
            const snapshot = await tx.get(db.collection(MEMBERSHIPS).doc(membershipId));
            return snapshot.exists ? snapshot.data() : undefined;
          },
          async roadmapItemIdsOwnedBy(teamId, memberRef, limit) {
            // A transactional query: the owner set is read in the same transaction as the membership delete.
            const snapshot = await tx.get(
              db.collection(ROADMAP_ITEMS).where("teamId", "==", teamId).where("ownerRef", "==", memberRef).limit(limit),
            );
            return snapshot.docs.map((doc) => doc.id);
          },
          clearRoadmapOwnerRef(itemId) {
            tx.update(db.collection(ROADMAP_ITEMS).doc(itemId), { ownerRef: null });
          },
          async boundConversationCount(memberRef, limit) {
            // Transactional: the binding set is re-read in the final transaction, so a concurrent binding is seen or conflicts.
            const snapshot = await tx.get(
              db.collectionGroup(CONVERSATIONS).where("participantMemberRef", "==", memberRef).select().limit(limit),
            );
            return snapshot.size;
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
  };
}

/**
 * Destroys the membership of `uid` in one team, with its memberRef-dependent references cleared first. This is the single
 * production entry point for ordinary removal. The fence subject is `uid`, the member being removed, never the admin. The
 * bounded batch size keeps each transaction well under the write limit.
 */
export async function destroyMembershipForRemoval(uid: string, membershipId: string): Promise<"done"> {
  return destroyMembershipInstance(
    {
      port: membershipAdapterPort(),
      bindings: {
        store: getDefaultConversationStore(),
        codec: { probeKey, decryptForClassification, encodeContent },
        discovery: createParticipantBindingDiscovery(),
        clock: () => new Date(),
        cleanupCapability: issueErasureOwnerCleanupCapability(),
      },
    },
    { membershipId, uid },
    100,
  );
}

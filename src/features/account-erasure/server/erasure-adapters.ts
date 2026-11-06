import "server-only";
import { FieldPath, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { ActorAuditErasurePort, ActorAuditTarget, ActorAuditTransaction } from "./actor-audit-erasure";
import type { PersonalDataErasurePort } from "./personal-data-erasure";
import type { SurveyParticipationTransaction, SurveyParticipationsErasurePort } from "./survey-participations-erasure";

/**
 * Production Admin SDK adapters for the port-based erasure steps (TASK-038). Each adapter maps one port exactly. Reads that
 * only select candidate ids are plain queries; every write that depends on a read runs in a transaction and re-checks it.
 * No adapter logs content, identifiers, or raw error text. Paths are built only from the verified uid or fixed names.
 *
 * Persisted names are literal. The actor-audit targets are a closed list, so each target has its own literal accessors
 * (see ACTOR_AUDIT_ACCESS) rather than a dynamic collection and field name.
 */

const PREFIX_END = "";

function assertUidSegment(uid: string): void {
  if (uid.length === 0 || uid.includes("/")) throw new Error("erasure adapter: invalid uid segment");
}

export function createPersonalDataPort(): PersonalDataErasurePort {
  const db = (): Firestore => getFirestoreDb();
  const owned = (uid: string) => {
    assertUidSegment(uid);
    return db().collection("userDevelopment").doc(uid);
  };
  return {
    async skillProfileExists(uid) {
      assertUidSegment(uid);
      return (await db().collection("skillProfiles").doc(uid).get()).exists;
    },
    async deleteSkillProfile(uid) {
      assertUidSegment(uid);
      await db().collection("skillProfiles").doc(uid).delete();
    },
    async userProfileExists(uid) {
      assertUidSegment(uid);
      return (await db().collection("userProfiles").doc(uid).get()).exists;
    },
    async deleteUserProfile(uid) {
      assertUidSegment(uid);
      await db().collection("userProfiles").doc(uid).delete();
    },
    async roleTargetIds(uid, limit) {
      const snapshot = await owned(uid).collection("roleTarget").select().limit(limit).get();
      return snapshot.docs.map((doc) => doc.id);
    },
    async deleteRoleTarget(uid, roleTargetId) {
      await owned(uid).collection("roleTarget").doc(roleTargetId).delete();
    },
    async goalIds(uid, limit) {
      const snapshot = await owned(uid).collection("goals").select().limit(limit).get();
      return snapshot.docs.map((doc) => doc.id);
    },
    async deleteGoal(uid, goalId) {
      await owned(uid).collection("goals").doc(goalId).delete();
    },
  };
}

export function createSurveyParticipationsPort(): SurveyParticipationsErasurePort {
  const db = (): Firestore => getFirestoreDb();
  return {
    async runTransaction<T>(work: (tx: SurveyParticipationTransaction) => Promise<T>): Promise<T> {
      const firestore = db();
      return firestore.runTransaction((tx) =>
        work({
          async getParticipation(participationId) {
            const snapshot = await tx.get(firestore.collection("surveyParticipations").doc(participationId));
            return snapshot.exists ? snapshot.data() : undefined;
          },
          deleteParticipation(participationId) {
            tx.delete(firestore.collection("surveyParticipations").doc(participationId));
          },
        }),
      );
    },
    async participationIdsFor(uid, limit) {
      assertUidSegment(uid);
      const firestore = db();
      const byField = await firestore.collection("surveyParticipations").where("uid", "==", uid).select().limit(limit).get();
      const prefix = `${uid}__`;
      const byPrefix = await firestore
        .collection("surveyParticipations")
        .where(FieldPath.documentId(), ">=", prefix)
        .where(FieldPath.documentId(), "<", `${prefix}${PREFIX_END}`)
        .select()
        .limit(limit)
        .get();
      return [...new Set([...byField.docs, ...byPrefix.docs].map((doc) => doc.id))].slice(0, limit);
    },
  };
}

/** Literal accessors for one closed actor-audit target. `find` returns one document id naming the uid. */
interface ActorAccess {
  readonly find: (db: Firestore, uid: string) => Promise<string | undefined>;
  readonly ref: (db: Firestore, documentId: string) => DocumentReference;
}

function access(
  find: (db: Firestore, uid: string) => Promise<string | undefined>,
  ref: (db: Firestore, documentId: string) => DocumentReference,
): ActorAccess {
  return { find, ref };
}

/** Keyed by `collection|field`, with one literal entry per closed target. An unknown target fails closed. */
const ACTOR_AUDIT_ACCESS: ReadonlyMap<string, ActorAccess> = new Map<string, ActorAccess>([
  ["surveys|createdBy", access(
    async (db, uid) => (await db.collection("surveys").where("createdBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("surveys").doc(id))],
  ["skillTrees|createdBy", access(
    async (db, uid) => (await db.collection("skillTrees").where("createdBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("skillTrees").doc(id))],
  ["skillTrees|updatedBy", access(
    async (db, uid) => (await db.collection("skillTrees").where("updatedBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("skillTrees").doc(id))],
  ["roleDefinitions|createdBy", access(
    async (db, uid) => (await db.collection("roleDefinitions").where("createdBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("roleDefinitions").doc(id))],
  ["roleDefinitions|updatedBy", access(
    async (db, uid) => (await db.collection("roleDefinitions").where("updatedBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("roleDefinitions").doc(id))],
  ["roleDefinitions|archivedBy", access(
    async (db, uid) => (await db.collection("roleDefinitions").where("archivedBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("roleDefinitions").doc(id))],
  ["challenges|resolvedBy", access(
    async (db, uid) => (await db.collection("challenges").where("resolvedBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("challenges").doc(id))],
  ["challenges|archivedBy", access(
    async (db, uid) => (await db.collection("challenges").where("archivedBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("challenges").doc(id))],
  ["roadmapItems|createdBy", access(
    async (db, uid) => (await db.collection("roadmapItems").where("createdBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("roadmapItems").doc(id))],
  ["roadmapItems|updatedBy", access(
    async (db, uid) => (await db.collection("roadmapItems").where("updatedBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("roadmapItems").doc(id))],
  ["roadmapItems|archivedBy", access(
    async (db, uid) => (await db.collection("roadmapItems").where("archivedBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("roadmapItems").doc(id))],
  ["skillProgress|updatedBy", access(
    async (db, uid) => (await db.collection("skillProgress").where("updatedBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("skillProgress").doc(id))],
  ["teamMemberships|grantedBy", access(
    async (db, uid) => (await db.collection("teamMemberships").where("grantedBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("teamMemberships").doc(id))],
  ["superadmins|grantedByUid", access(
    async (db, uid) => (await db.collection("superadmins").where("grantedByUid", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("superadmins").doc(id))],
  ["superadmins|revokedByUid", access(
    async (db, uid) => (await db.collection("superadmins").where("revokedByUid", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("superadmins").doc(id))],
  ["teamMemberships|roleUpdatedBy", access(
    async (db, uid) => (await db.collection("teamMemberships").where("roleUpdatedBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("teamMemberships").doc(id))],
  ["teams|createdBy", access(
    async (db, uid) => (await db.collection("teams").where("createdBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("teams").doc(id))],
  // A-13 (teamSystems). `assessedBy` lives inside each assessment map, so each map is its own closed target.
  ["teamSystems|createdBy", access(
    async (db, uid) => (await db.collection("teamSystems").where("createdBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("teamSystems").doc(id))],
  ["teamSystems|updatedBy", access(
    async (db, uid) => (await db.collection("teamSystems").where("updatedBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("teamSystems").doc(id))],
  ["teamSystems|availability.assessedBy", access(
    async (db, uid) => (await db.collection("teamSystems").where("availability.assessedBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("teamSystems").doc(id))],
  ["teamSystems|maintainability.assessedBy", access(
    async (db, uid) => (await db.collection("teamSystems").where("maintainability.assessedBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("teamSystems").doc(id))],
  ["teamSystems|security.assessedBy", access(
    async (db, uid) => (await db.collection("teamSystems").where("security.assessedBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("teamSystems").doc(id))],
  ["teamSystems|reliability.assessedBy", access(
    async (db, uid) => (await db.collection("teamSystems").where("reliability.assessedBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("teamSystems").doc(id))],
  ["teamSystems|testability.assessedBy", access(
    async (db, uid) => (await db.collection("teamSystems").where("testability.assessedBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("teamSystems").doc(id))],
  ["teamSystems|deployability.assessedBy", access(
    async (db, uid) => (await db.collection("teamSystems").where("deployability.assessedBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("teamSystems").doc(id))],
  ["teamSystems|observability.assessedBy", access(
    async (db, uid) => (await db.collection("teamSystems").where("observability.assessedBy", "==", uid).select().limit(1).get()).docs[0]?.id,
    (db, id) => db.collection("teamSystems").doc(id))],
]);

function accessFor(target: ActorAuditTarget): ActorAccess {
  const found = ACTOR_AUDIT_ACCESS.get(`${target.collection}|${target.field}`);
  // A target outside the closed list fails closed; it is never read as "no document".
  if (found === undefined) throw new Error("erasure adapter: unknown actor-audit target");
  return found;
}

export function createActorAuditPort(): ActorAuditErasurePort {
  const db = (): Firestore => getFirestoreDb();
  return {
    async runTransaction<T>(work: (tx: ActorAuditTransaction) => Promise<T>): Promise<T> {
      const firestore = db();
      return firestore.runTransaction((tx) =>
        work({
          async getDocument(target, documentId) {
            const snapshot = await tx.get(accessFor(target).ref(firestore, documentId));
            return snapshot.exists ? snapshot.data() : undefined;
          },
          clearActorField(target, documentId) {
            // The target's own field is set to null. Only that field changes.
            const ref = accessFor(target).ref(firestore, documentId);
            if (target.field === "createdBy") tx.update(ref, { createdBy: null });
            else if (target.field === "updatedBy") tx.update(ref, { updatedBy: null });
            else if (target.field === "archivedBy") tx.update(ref, { archivedBy: null });
            else if (target.field === "resolvedBy") tx.update(ref, { resolvedBy: null });
            else if (target.field === "grantedBy") tx.update(ref, { grantedBy: null });
            else if (target.field === "roleUpdatedBy") tx.update(ref, { roleUpdatedBy: null });
            else if (target.field === "grantedByUid") tx.update(ref, { grantedByUid: null });
            else if (target.field === "revokedByUid") tx.update(ref, { revokedByUid: null });
            // A-13 nested assessment actor: only the `assessedBy` leaf is nulled; `assessedAt` and the value are kept.
            else if (target.field === "availability.assessedBy") tx.update(ref, { "availability.assessedBy": null });
            else if (target.field === "maintainability.assessedBy") tx.update(ref, { "maintainability.assessedBy": null });
            else if (target.field === "security.assessedBy") tx.update(ref, { "security.assessedBy": null });
            else if (target.field === "reliability.assessedBy") tx.update(ref, { "reliability.assessedBy": null });
            else if (target.field === "testability.assessedBy") tx.update(ref, { "testability.assessedBy": null });
            else if (target.field === "deployability.assessedBy") tx.update(ref, { "deployability.assessedBy": null });
            else if (target.field === "observability.assessedBy") tx.update(ref, { "observability.assessedBy": null });
            else throw new Error("erasure adapter: unknown actor-audit field");
          },
        }),
      );
    },
    async findActorReference(uid, target) {
      assertUidSegment(uid);
      return accessFor(target).find(db(), uid);
    },
  };
}

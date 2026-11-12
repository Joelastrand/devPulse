import { roadmapOwnerIndex } from "../../roadmap/domain/roadmap-item-content-codec";
import "server-only";
import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { invitationEmailIndex } from "../../teams/domain/team-invitation-content-codec";
import { invitationBelongsToErasedPerson } from "./invitation-match";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { InventorySweep } from "./inventory";
import type { SweepBinding, SweepCounter } from "./verification-sweep";

/**
 * Production residual counter for the verification sweep (TASK-038, BR-5). It returns only a number of matches. Every
 * inventory sweep has its own explicit counter with literal collection and field names, so the production code contains no
 * dynamic persistence names (the erasure guard reads literal names only). A sweep without a counter fails closed, and the
 * completeness test in erasure-adapters-sweep.test.ts fails if the registry gains a sweep this table does not cover.
 *
 * E-mail-bound counters throw when the binding has no normalized e-mail, so a missing value never reads as zero. Keys only
 * where the query needs no content. Ids and content are never returned or logged.
 */

type Counter = (db: Firestore, binding: SweepBinding) => Promise<number>;

const PREFIX_END = "";

function requireEmail(binding: SweepBinding): string {
  if (binding.normalizedEmail === undefined || binding.normalizedEmail.length === 0) {
    throw new Error("erasure sweep: the normalized e-mail is required for this query and was not supplied");
  }
  return binding.normalizedEmail;
}

/** `${collection}|${kind}|${field or value}`: the registry shape that selects one counter. */
export function sweepKeyOf(sweep: InventorySweep): string {
  const query = sweep.query;
  const name = "field" in query ? query.field : "value" in query ? query.value : "";
  return `${sweep.collection}|${query.kind}|${name}`;
}

/** Memberships of the uid: documents with its `uid` field, and legacy documents (no `uid` field) by id prefix. */
async function membershipsOf(db: Firestore, uid: string): Promise<Array<Record<string, unknown>>> {
  const byField = await db.collection("teamMemberships").where("uid", "==", uid).get();
  const byPrefix = await db
    .collection("teamMemberships")
    .where(FieldPath.documentId(), ">=", `${uid}__`)
    .where(FieldPath.documentId(), "<", `${uid}__${PREFIX_END}`)
    .get();
  const legacy = byPrefix.docs.filter((doc) => (doc.data() as Record<string, unknown>).uid === undefined);
  return [...byField.docs, ...legacy].map((doc) => doc.data() as Record<string, unknown>);
}

const COUNTERS: ReadonlyMap<string, Counter> = new Map<string, Counter>([
  // I-1, I-2: owner documents by id.
  ["skillProfiles|docIdEquals|uid", async (db, b) => ((await db.collection("skillProfiles").doc(b.uid).get()).exists ? 1 : 0)],
  ["userProfiles|docIdEquals|uid", async (db, b) => ((await db.collection("userProfiles").doc(b.uid).get()).exists ? 1 : 0)],
  // I-3 to I-6: owner subtrees (direct documents; see VERIFICATION.md on nested collections).
  ["userDevelopment/{uid}/goals|subtree|", async (db, b) => (await db.collection("userDevelopment").doc(b.uid).collection("goals").get()).size],
  // I-4: the formal role assignment, one document keyed by uid.
  ["roleAssignments|docIdEquals|uid", async (db, b) => ((await db.collection("roleAssignments").doc(b.uid).get()).exists ? 1 : 0)],
  ["userDevelopment/{uid}/responsibilities|subtree|", async (db, b) =>
    (await db.collection("userDevelopment").doc(b.uid).collection("responsibilities").get()).size],
  ["userDevelopment/{uid}/achievements|subtree|", async (db, b) =>
    (await db.collection("userDevelopment").doc(b.uid).collection("achievements").get()).size],
  ["userDevelopment/{uid}/conversations|subtree|", async (db, b) =>
    (await db.collection("userDevelopment").doc(b.uid).collection("conversations").get()).size],
  ["userDevelopment/{uid}/conversationParticipations|subtree|", async (db, b) =>
    (await db.collection("userDevelopment").doc(b.uid).collection("conversationParticipations").get()).size],
  // I-7, I-8: participant bindings in others' conversations (collection group).
  ["conversations|collectionGroupFieldEquals|participantUid", async (db, b) =>
    (await db.collectionGroup("conversations").where("participantUid", "==", b.uid).select().get()).size],
  ["conversations|perMembership|participantMemberRef", async (db, b) => {
    let total = 0;
    for (const membership of await membershipsOf(db, b.uid)) {
      if (typeof membership.memberRef !== "string") continue;
      total += (await db.collectionGroup("conversations").where("participantMemberRef", "==", membership.memberRef).select().get()).size;
    }
    return total;
  }],
  // I-9: memberships by id prefix and by uid field; memberRef-linked roadmap ownerRef (A-5).
  ["teamMemberships|docIdStartsWith|uid", async (db, b) =>
    (await db.collection("teamMemberships").where(FieldPath.documentId(), ">=", `${b.uid}__`).where(FieldPath.documentId(), "<", `${b.uid}__${PREFIX_END}`).select().get()).size],
  ["superadmins|docIdEquals|uid", async (db, b) => ((await db.collection("superadmins").doc(b.uid).get()).exists ? 1 : 0)],
  ["superadmins|fieldEquals|grantedByUid", async (db, b) => (await db.collection("superadmins").where("grantedByUid", "==", b.uid).select().get()).size],
  ["superadmins|fieldEquals|revokedByUid", async (db, b) => (await db.collection("superadmins").where("revokedByUid", "==", b.uid).select().get()).size],
  ["teamMemberships|fieldEquals|uid", async (db, b) => (await db.collection("teamMemberships").where("uid", "==", b.uid).select().get()).size],
  ["teamMemberships|perMembership|memberRef", async (db, b) => (await membershipsOf(db, b.uid)).length],
  ["roadmapItems|perMembership|ownerRef", async (db, b) => {
    let total = 0;
    for (const membership of await membershipsOf(db, b.uid)) {
      if (typeof membership.teamId !== "string" || typeof membership.memberRef !== "string") continue;
      total += (await db.collection("roadmapItems").where("teamId", "==", membership.teamId).where("ownerRefIndex", "==", roadmapOwnerIndex(membership.teamId, membership.memberRef)).select().get()).size;
    }
    return total;
  }],
  // I-10: access requests by id prefix, uid field, resolvedBy.
  ["teamAccessRequests|docIdStartsWith|uid", async (db, b) =>
    (await db.collection("teamAccessRequests").where(FieldPath.documentId(), ">=", `${b.uid}__`).where(FieldPath.documentId(), "<", `${b.uid}__${PREFIX_END}`).select().get()).size],
  ["teamAccessRequests|fieldEquals|uid", async (db, b) => (await db.collection("teamAccessRequests").where("uid", "==", b.uid).select().get()).size],
  ["teamAccessRequests|fieldEquals|resolvedBy", async (db, b) => (await db.collection("teamAccessRequests").where("resolvedBy", "==", b.uid).select().get()).size],
  // I-11: invitations by the blind index of the e-mail (the address itself is sealed), the document-id index tail, resolvedUid, invitedBy.
  ["teamInvitations|fieldEquals|emailIndex", async (db, b) => (await db.collection("teamInvitations").where("emailIndex", "==", invitationEmailIndex(requireEmail(b))).select().get()).size],
  ["teamInvitations|docIdEndsWith|normalizedEmail", async (db, b) => {
    // Same ownership rule as the step (invitation-match.ts): a suffix match counts only when it belongs to the erased person.
    const email = requireEmail(b);
    const index = invitationEmailIndex(email);
    const keys = await db.collection("teamInvitations").select().get();
    const snapshots = await Promise.all(keys.docs.filter((doc) => doc.id.endsWith(`__${index}`)).map((doc) => doc.ref.get()));
    return snapshots.filter((snap) => snap.exists && invitationBelongsToErasedPerson(snap.id, snap.data() as Record<string, unknown>, email, b.uid)).length;
  }],
  ["teamInvitations|fieldEquals|resolvedUid", async (db, b) => (await db.collection("teamInvitations").where("resolvedUid", "==", b.uid).select().get()).size],
  ["teamInvitations|fieldEquals|invitedBy", async (db, b) => (await db.collection("teamInvitations").where("invitedBy", "==", b.uid).select().get()).size],
  // I-12: survey participations by id prefix and uid field.
  ["surveyParticipations|docIdStartsWith|uid", async (db, b) =>
    (await db.collection("surveyParticipations").where(FieldPath.documentId(), ">=", `${b.uid}__`).where(FieldPath.documentId(), "<", `${b.uid}__${PREFIX_END}`).select().get()).size],
  ["surveyParticipations|fieldEquals|uid", async (db, b) => (await db.collection("surveyParticipations").where("uid", "==", b.uid).select().get()).size],
  // A-17: team skill definition actor fields (team-owned skills).
  ["teamSkills|fieldEquals|createdBy", async (db, b) => (await db.collection("teamSkills").where("createdBy", "==", b.uid).select().get()).size],
  ["teamSkills|fieldEquals|updatedBy", async (db, b) => (await db.collection("teamSkills").where("updatedBy", "==", b.uid).select().get()).size],
  // A-19: acting administrator of a collaborative team level (team-owned skills, SPEC §12).
  ["teamManualAssessments|fieldEquals|updatedBy", async (db, b) => (await db.collection("teamManualAssessments").where("updatedBy", "==", b.uid).select().get()).size],
  // I-19: a person's team-skill ratings (team-owned skills), located by the stored uid field.
  ["teamSkillAssessments|fieldEquals|uid", async (db, b) => (await db.collection("teamSkillAssessments").where("uid", "==", b.uid).select().get()).size],
  // I-13, I-14, A-8: forum authorship and tombstone markers.
  ["forumThreads|fieldEquals|authorUid", async (db, b) => (await db.collection("forumThreads").where("authorUid", "==", b.uid).select().get()).size],
  ["forumReplies|fieldEquals|authorUid", async (db, b) => (await db.collection("forumReplies").where("authorUid", "==", b.uid).select().get()).size],
  ["forumReplies|fieldEquals|deletedBy", async (db, b) => (await db.collection("forumReplies").where("deletedBy", "==", b.uid).select().get()).size],
  // A-1 to A-12: actor fields (single-field equality).
  ["surveys|fieldEquals|createdBy", async (db, b) => (await db.collection("surveys").where("createdBy", "==", b.uid).select().get()).size],
  ["skillTrees|fieldEquals|createdBy", async (db, b) => (await db.collection("skillTrees").where("createdBy", "==", b.uid).select().get()).size],
  ["skillTrees|fieldEquals|updatedBy", async (db, b) => (await db.collection("skillTrees").where("updatedBy", "==", b.uid).select().get()).size],
  ["roleDefinitions|fieldEquals|createdBy", async (db, b) => (await db.collection("roleDefinitions").where("createdBy", "==", b.uid).select().get()).size],
  ["roleDefinitions|fieldEquals|updatedBy", async (db, b) => (await db.collection("roleDefinitions").where("updatedBy", "==", b.uid).select().get()).size],
  ["roleDefinitions|fieldEquals|archivedBy", async (db, b) => (await db.collection("roleDefinitions").where("archivedBy", "==", b.uid).select().get()).size],
  ["roleAssignments|fieldEquals|createdBy", async (db, b) => (await db.collection("roleAssignments").where("createdBy", "==", b.uid).select().get()).size],
  ["roleAssignments|fieldEquals|updatedBy", async (db, b) => (await db.collection("roleAssignments").where("updatedBy", "==", b.uid).select().get()).size],
  ["roadmapItems|fieldEquals|createdBy", async (db, b) => (await db.collection("roadmapItems").where("createdBy", "==", b.uid).select().get()).size],
  ["roadmapItems|fieldEquals|updatedBy", async (db, b) => (await db.collection("roadmapItems").where("updatedBy", "==", b.uid).select().get()).size],
  ["roadmapItems|fieldEquals|archivedBy", async (db, b) => (await db.collection("roadmapItems").where("archivedBy", "==", b.uid).select().get()).size],
  ["skillProgress|fieldEquals|updatedBy", async (db, b) => (await db.collection("skillProgress").where("updatedBy", "==", b.uid).select().get()).size],
  ["challenges|fieldEquals|resolvedBy", async (db, b) => (await db.collection("challenges").where("resolvedBy", "==", b.uid).select().get()).size],
  ["challenges|fieldEquals|archivedBy", async (db, b) => (await db.collection("challenges").where("archivedBy", "==", b.uid).select().get()).size],
  ["teamMemberships|fieldEquals|grantedBy", async (db, b) => (await db.collection("teamMemberships").where("grantedBy", "==", b.uid).select().get()).size],
  ["teamMemberships|fieldEquals|roleUpdatedBy", async (db, b) => (await db.collection("teamMemberships").where("roleUpdatedBy", "==", b.uid).select().get()).size],
  ["teams|fieldEquals|createdBy", async (db, b) => (await db.collection("teams").where("createdBy", "==", b.uid).select().get()).size],
  // A-13 (teamSystems). `assessedBy` is one registry field stored in seven assessment maps; the counter sums the seven.
  ["teamSystems|fieldEquals|createdBy", async (db, b) => (await db.collection("teamSystems").where("createdBy", "==", b.uid).select().get()).size],
  ["teamSystems|fieldEquals|updatedBy", async (db, b) => (await db.collection("teamSystems").where("updatedBy", "==", b.uid).select().get()).size],
  ["teamSystems|fieldEquals|assessedBy", async (db, b) => {
    let total = 0;
    total += (await db.collection("teamSystems").where("availability.assessedBy", "==", b.uid).select().get()).size;
    total += (await db.collection("teamSystems").where("maintainability.assessedBy", "==", b.uid).select().get()).size;
    total += (await db.collection("teamSystems").where("security.assessedBy", "==", b.uid).select().get()).size;
    total += (await db.collection("teamSystems").where("reliability.assessedBy", "==", b.uid).select().get()).size;
    total += (await db.collection("teamSystems").where("testability.assessedBy", "==", b.uid).select().get()).size;
    total += (await db.collection("teamSystems").where("deployability.assessedBy", "==", b.uid).select().get()).size;
    total += (await db.collection("teamSystems").where("observability.assessedBy", "==", b.uid).select().get()).size;
    return total;
  }],
  // A-14 (teamSystems.knowledgeMemberRefs, memberRef kind): one array-contains query per membership, scoped to its team.
  ["teamSystems|perMembership|knowledgeMemberRefs", async (db, b) => {
    let total = 0;
    for (const membership of await membershipsOf(db, b.uid)) {
      if (typeof membership.teamId !== "string" || typeof membership.memberRef !== "string") continue;
      total += (await db.collection("teamSystems").where("teamId", "==", membership.teamId)
        .where("knowledgeMemberRefs", "array-contains", membership.memberRef).select().get()).size;
    }
    return total;
  }],
  // A-15 (teamProjectParticipations.memberRef, memberRef kind, DELETE): one equality query per membership, scoped to its team.
  ["teamProjectParticipations|perMembership|memberRef", async (db, b) => {
    let total = 0;
    for (const membership of await membershipsOf(db, b.uid)) {
      if (typeof membership.teamId !== "string" || typeof membership.memberRef !== "string") continue;
      total += (await db.collection("teamProjectParticipations").where("teamId", "==", membership.teamId)
        .where("memberRef", "==", membership.memberRef).select().get()).size;
    }
    return total;
  }],
]);

export function createSweepCounter(): SweepCounter {
  return {
    async countMatches(sweep: InventorySweep, binding: SweepBinding): Promise<number> {
      const counter = COUNTERS.get(sweepKeyOf(sweep));
      // A sweep without a counter fails closed: a missing counter must never read as zero.
      if (counter === undefined) throw new Error("erasure sweep: no counter for this inventory sweep");
      return counter(getFirestoreDb(), binding);
    },
  };
}

/** The counter keys this table covers, for the completeness test. */
export function sweepCounterKeys(): readonly string[] {
  return [...COUNTERS.keys()];
}

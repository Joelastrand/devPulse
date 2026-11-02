
import { isErasureOwnerCleanupCapability } from "./erasure-owner-cleanup-capability";
import "server-only";
import { membershipDocId } from "../../teams/domain/team-membership";
import { Timestamp, type DocumentData, type Firestore, type Transaction } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { assertNoErasureRecordInTransaction, runFencedTransaction } from "../../auth/server/erasure-write-fence";
import { READ_WINDOW } from "../domain/conversation-constants";
import { createTransactionTeamEligibilityReader } from "./team-eligibility";
import {
  CONVERSATION_RAW_READ_LIMIT,
  OWNER_CONVERSATIONS_SUBCOLLECTION,
  PARTICIPATION_INDEX_SUBCOLLECTION,
  USER_DEVELOPMENT_COLLECTION,
  assertConversationIdSegment,
  assertUidSegment,
  ownerDocumentPath,
  participationDocumentPath,
  patchedOwnerKeys,
  toOwnerRecord,
  toParticipationRecord,
  type ConversationStore,
  type ConversationTransaction,
  type MissingCreatedAtScan,
  type OwnerDocumentPatch,
  type OwnerDocumentWrite,
  type ParticipationIndexWrite,
  type RawConversationData,
  type RawConversationDoc,
  type RawConversationWindow,
} from "./conversation-store-types";

const MEMBERSHIPS_COLLECTION = "teamMemberships";

const CREATED_AT_FIELD = "createdAt";
const INVITED_AT_FIELD = "invitedAt";

/*
 * The storage paths are written here with named collection constants, so the erasure inventory guard can resolve every
 * collection name statically. Validation still runs in the types module (`ownerDocumentPath`,
 * `participationDocumentPath`), so the same inputs are rejected and the same references are produced as before.
 */

/** The owner conversation document under the owner's subtree (the path shape is owned by the types module). */
function ownerDocumentRef(db: Firestore, ownerUid: string, conversationId: string) {
  const [, uid, , id] = ownerDocumentPath(ownerUid, conversationId);
  return db.collection(USER_DEVELOPMENT_COLLECTION).doc(uid).collection(OWNER_CONVERSATIONS_SUBCOLLECTION).doc(id);
}

/** The participant index document under the caller's subtree (the path shape is owned by the types module). */
function participationDocumentRef(db: Firestore, callerUid: string, conversationId: string) {
  const [, uid, , id] = participationDocumentPath(callerUid, conversationId);
  return db.collection(USER_DEVELOPMENT_COLLECTION).doc(uid).collection(PARTICIPATION_INDEX_SUBCOLLECTION).doc(id);
}

/** The owner's conversations subtree, as a collection reference. */
function ownerConversationsCollection(db: Firestore, uid: string) {
  return db.collection(USER_DEVELOPMENT_COLLECTION).doc(uid).collection(OWNER_CONVERSATIONS_SUBCOLLECTION);
}

/** The participant index subtree of one uid, as a collection reference. */
function participationIndexCollection(db: Firestore, uid: string) {
  return db.collection(USER_DEVELOPMENT_COLLECTION).doc(uid).collection(PARTICIPATION_INDEX_SUBCOLLECTION);
}

/**
 * Maps top-level Firestore `Timestamp`s to `Date`, so no Firestore type leaves the store. Everything else passes through
 * untouched for the TASK-002 parsers to judge. Nothing is repaired or normalised.
 */
function toRawData(data: DocumentData): RawConversationData {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, value instanceof Timestamp ? value.toDate() : value]),
  );
}

/** Converts the canonical record's `Date` values to Firestore `Timestamp`s. Strings, `null` and numbers pass as given. */
function toFirestoreRecord(record: Record<string, unknown>): DocumentData {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, value instanceof Date ? Timestamp.fromDate(value) : value]),
  );
}

/** Builds the canonical owner write. Only canonical keys are copied; a caller object is never spread. */
function ownerWrite(doc: OwnerDocumentWrite): DocumentData {
  return toFirestoreRecord(toOwnerRecord(doc));
}

/** Builds the canonical patch: only the keys the caller set, from the canonical list, never an arbitrary object. */
function ownerPatch(patch: OwnerDocumentPatch): DocumentData {
  const out: Record<string, unknown> = {};
  for (const key of patchedOwnerKeys(patch)) out[key] = patch[key];
  return toFirestoreRecord(out);
}

/** The first `READ_WINDOW` documents of a probe query, with the raw count. The probe document is never returned. */
function windowOf(docs: Array<{ id: string; data(): DocumentData }>): RawConversationWindow {
  return {
    docs: docs.slice(0, READ_WINDOW).map((doc): RawConversationDoc => ({ id: doc.id, data: toRawData(doc.data()) })),
    rawCount: docs.length,
  };
}

/** Transaction adapter over the Admin transaction. Paths come from the types module; writes use the canonical records. */
function transactionAdapter(db: Firestore, tx: Transaction): ConversationTransaction {
  const owner = (ownerUid: string, conversationId: string) =>
    ownerDocumentRef(db, ownerUid, conversationId);
  const index = (callerUid: string, conversationId: string) =>
    participationDocumentRef(db, callerUid, conversationId);
  return {
    teamEligibility: createTransactionTeamEligibilityReader(db, tx),
    async getOwner(ownerUid, conversationId) {
      const snapshot = await tx.get(owner(ownerUid, conversationId));
      return snapshot.exists ? toRawData(snapshot.data() ?? {}) : undefined;
    },
    createOwner(ownerUid, conversationId, doc) {
      tx.create(owner(ownerUid, conversationId), ownerWrite(doc));
    },
    setOwner(ownerUid, conversationId, doc) {
      tx.set(owner(ownerUid, conversationId), ownerWrite(doc));
    },
    updateOwner(ownerUid, conversationId, patch) {
      tx.update(owner(ownerUid, conversationId), ownerPatch(patch));
    },
    deleteOwner(ownerUid, conversationId) {
      tx.delete(owner(ownerUid, conversationId));
    },
    touchMembership(uid, teamId, memberRef) {
      tx.update(db.collection(MEMBERSHIPS_COLLECTION).doc(membershipDocId(uid, teamId)), { memberRef });
    },
    async getParticipation(callerUid, conversationId) {
      const snapshot = await tx.get(index(callerUid, conversationId));
      return snapshot.exists ? toRawData(snapshot.data() ?? {}) : undefined;
    },
    setParticipation(callerUid, conversationId, entry: ParticipationIndexWrite) {
      tx.set(index(callerUid, conversationId), toFirestoreRecord(toParticipationRecord(entry)));
    },
    deleteParticipation(callerUid, conversationId) {
      tx.delete(index(callerUid, conversationId));
    },
  };
}

/**
 * The Admin SDK implementation of {@link ConversationStore} (server-only). Every path is built from a caller-supplied
 * verified uid and a validated id. There is no query across owners, no group-wide query, and every query is limited.
 * Firestore errors propagate unchanged: classification and error mapping belong to the operations.
 */
export function getDefaultConversationStore(): ConversationStore {
  return {
    newOwnerId(ownerUid) {
      assertUidSegment(ownerUid);
      const id = ownerConversationsCollection(getFirestoreDb(), ownerUid).doc().id;
      assertConversationIdSegment(id);
      return id;
    },

    async listOwnerWindow(ownerUid) {
      assertUidSegment(ownerUid);
      const snapshot = await ownerConversationsCollection(getFirestoreDb(), ownerUid)
        .orderBy(CREATED_AT_FIELD, "desc")
        .limit(CONVERSATION_RAW_READ_LIMIT)
        .get();
      return windowOf(snapshot.docs);
    },

    async scanOwnerMissingCreatedAt(ownerUid): Promise<MissingCreatedAtScan> {
      assertUidSegment(ownerUid);
      const snapshot = await ownerConversationsCollection(getFirestoreDb(), ownerUid)
        .select(CREATED_AT_FIELD)
        .limit(CONVERSATION_RAW_READ_LIMIT)
        .get();
      return {
        missingCreatedAtIds: snapshot.docs
          .slice(0, READ_WINDOW)
          .filter((doc) => doc.data()[CREATED_AT_FIELD] === undefined)
          .map((doc) => doc.id),
        rawCount: snapshot.docs.length,
      };
    },

    async countOwner(ownerUid) {
      assertUidSegment(ownerUid);
      const snapshot = await ownerConversationsCollection(getFirestoreDb(), ownerUid).count().get();
      return snapshot.data().count;
    },

    async listOwnerIdsForErasure(ownerUid, limit) {
      assertUidSegment(ownerUid);
      // `select()` with no fields: a keys-only read, so malformed and createdAt-less documents are included.
      const snapshot = await ownerConversationsCollection(getFirestoreDb(), ownerUid).select().limit(limit).get();
      return snapshot.docs.map((doc) => doc.id);
    },

    async listParticipationIdsForErasure(callerUid, limit) {
      assertUidSegment(callerUid);
      const snapshot = await participationIndexCollection(getFirestoreDb(), callerUid).select().limit(limit).get();
      return snapshot.docs.map((doc) => doc.id);
    },


    async getOwner(ownerUid, conversationId) {
      const snapshot = await ownerDocumentRef(getFirestoreDb(), ownerUid, conversationId).get();
      return snapshot.exists ? toRawData(snapshot.data() ?? {}) : undefined;
    },

    async listParticipationWindow(callerUid) {
      assertUidSegment(callerUid);
      const snapshot = await participationIndexCollection(getFirestoreDb(), callerUid)
        .orderBy(INVITED_AT_FIELD, "desc")
        .limit(CONVERSATION_RAW_READ_LIMIT)
        .get();
      return windowOf(snapshot.docs);
    },

    async countParticipation(callerUid) {
      assertUidSegment(callerUid);
      const snapshot = await participationIndexCollection(getFirestoreDb(), callerUid).count().get();
      return snapshot.data().count;
    },

    async getParticipation(callerUid, conversationId) {
      const snapshot = await participationDocumentRef(getFirestoreDb(), callerUid, conversationId).get();
      return snapshot.exists ? toRawData(snapshot.data() ?? {}) : undefined;
    },

    runErasureCleanupTransaction(capability, work) {
      // Refused before any read or write unless this module family minted the capability (TASK-038 decision, 2026-11-02).
      if (!isErasureOwnerCleanupCapability(capability)) {
        return Promise.reject(new Error("erasure cleanup capability required"));
      }
      const db = getFirestoreDb();
      return db.runTransaction((tx) => work(transactionAdapter(db, tx)));
    },

    runOwnerTransaction(ownerUid, work, options) {
      const db = getFirestoreDb();
      // The erasure fence is read first, in the same transaction (TASK-027, BR-4(b)).
      if (options?.secondFence === undefined) {
        return runFencedTransaction(db, ownerUid, (tx) => work(transactionAdapter(db, tx)));
      }
      // An invitation also writes the invitee's participation index, so the invitee's fence is read in the same transaction (TASK-038).
      return db.runTransaction(async (tx) => {
        await assertNoErasureRecordInTransaction(db, tx, ownerUid);
        await assertNoErasureRecordInTransaction(db, tx, options.secondFence as string);
        return work(transactionAdapter(db, tx));
      });
    },

    runParticipantTransaction(callerUid, work) {
      const db = getFirestoreDb();
      // The acting participant's erasure record is read first (TASK-028, BR-4(b)).
      return runFencedTransaction(db, callerUid, (tx) => work(transactionAdapter(db, tx)));
    },
  };
}

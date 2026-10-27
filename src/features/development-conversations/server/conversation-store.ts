import "server-only";
import { Timestamp, type DocumentData, type Firestore, type Transaction } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
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

const CREATED_AT_FIELD = "createdAt";
const INVITED_AT_FIELD = "invitedAt";

/**
 * Resolves a path built by the types module into an Admin document reference. The segments come from the types module
 * (never caller-built), so no literal storage name is written here.
 */
function documentRef(db: Firestore, segments: readonly string[]) {
  const [parent, parentId, subcollection, id] = segments;
  return db.collection(parent).doc(parentId).collection(subcollection).doc(id);
}

/** The owner subtree or the index subtree of one uid, as a collection reference. */
function subtree(db: Firestore, uid: string, subcollection: string) {
  return db.collection(USER_DEVELOPMENT_COLLECTION).doc(uid).collection(subcollection);
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
    documentRef(db, ownerDocumentPath(ownerUid, conversationId));
  const index = (callerUid: string, conversationId: string) =>
    documentRef(db, participationDocumentPath(callerUid, conversationId));
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
      const id = subtree(getFirestoreDb(), ownerUid, OWNER_CONVERSATIONS_SUBCOLLECTION).doc().id;
      assertConversationIdSegment(id);
      return id;
    },

    async listOwnerWindow(ownerUid) {
      assertUidSegment(ownerUid);
      const snapshot = await subtree(getFirestoreDb(), ownerUid, OWNER_CONVERSATIONS_SUBCOLLECTION)
        .orderBy(CREATED_AT_FIELD, "desc")
        .limit(CONVERSATION_RAW_READ_LIMIT)
        .get();
      return windowOf(snapshot.docs);
    },

    async scanOwnerMissingCreatedAt(ownerUid): Promise<MissingCreatedAtScan> {
      assertUidSegment(ownerUid);
      const snapshot = await subtree(getFirestoreDb(), ownerUid, OWNER_CONVERSATIONS_SUBCOLLECTION)
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
      const snapshot = await subtree(getFirestoreDb(), ownerUid, OWNER_CONVERSATIONS_SUBCOLLECTION).count().get();
      return snapshot.data().count;
    },

    async getOwner(ownerUid, conversationId) {
      const snapshot = await documentRef(getFirestoreDb(), ownerDocumentPath(ownerUid, conversationId)).get();
      return snapshot.exists ? toRawData(snapshot.data() ?? {}) : undefined;
    },

    async listParticipationWindow(callerUid) {
      assertUidSegment(callerUid);
      const snapshot = await subtree(getFirestoreDb(), callerUid, PARTICIPATION_INDEX_SUBCOLLECTION)
        .orderBy(INVITED_AT_FIELD, "desc")
        .limit(CONVERSATION_RAW_READ_LIMIT)
        .get();
      return windowOf(snapshot.docs);
    },

    async countParticipation(callerUid) {
      assertUidSegment(callerUid);
      const snapshot = await subtree(getFirestoreDb(), callerUid, PARTICIPATION_INDEX_SUBCOLLECTION).count().get();
      return snapshot.data().count;
    },

    async getParticipation(callerUid, conversationId) {
      const snapshot = await documentRef(getFirestoreDb(), participationDocumentPath(callerUid, conversationId)).get();
      return snapshot.exists ? toRawData(snapshot.data() ?? {}) : undefined;
    },

    runTransaction(work) {
      const db = getFirestoreDb();
      return db.runTransaction((tx) => work(transactionAdapter(db, tx)));
    },
  };
}

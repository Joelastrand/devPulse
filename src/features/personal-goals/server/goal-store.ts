import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { runFencedTransaction } from "../../auth/server/erasure-write-fence";
import { decryptRecord, encryptRecord, RecordEnvelopeError, readRecordEnvelope } from "../../../lib/encryption/record-envelope";
import { toStoredGoalData, type Goal } from "../domain/goal";
import {
  GOAL_RAW_READ_LIMIT,
  assertGoalIdSegment,
  assertOwnerSegment,
  type GoalStore,
  type RawGoalData,
} from "./goal-store-types";

const USER_DEVELOPMENT_COLLECTION = "userDevelopment";
const GOALS_COLLECTION = "goals";
const CREATED_AT_FIELD = "createdAt";

function goalsCollection(ownerUid: string) {
  assertOwnerSegment(ownerUid);
  return getFirestoreDb()
    .collection(USER_DEVELOPMENT_COLLECTION)
    .doc(ownerUid)
    .collection(GOALS_COLLECTION);
}

function goalRef(ownerUid: string, goalId: string) {
  assertGoalIdSegment(goalId);
  return goalsCollection(ownerUid).doc(goalId);
}

/**
 * Persisted representation of a goal (BR-6, BR-14): exactly the canonical keys, built field by field, with
 * application `Date`s converted to Firestore `Timestamp`s. Optional keys are omitted, never null. The
 * timestamps are written as given: no clamping and no server-timestamp sentinel (BR-64).
 */
/**
 * Business content of a goal (title, optional skill-tree label, optional target date). It is encrypted as one v2 record
 * envelope bound to the goal's document path. Lifecycle fields (`status`, timestamps) stay plaintext: the list is
 * ordered by `createdAt`, and the status drives the completed/active rules.
 */
const GOAL_CONTENT_FIELD = "content";

function goalContext(owner: string, goalId: string): string {
  return `goal:${owner}:${goalId}`;
}

function toFirestoreGoalData(owner: string, goalId: string, goal: Goal): Record<string, unknown> {
  const stored = toStoredGoalData(goal);
  const content = {
    title: stored.title,
    ...(stored.treeId !== undefined ? { treeId: stored.treeId } : {}),
    ...(stored.targetDate !== undefined ? { targetDate: stored.targetDate } : {}),
  };
  return {
    status: stored.status,
    createdAt: Timestamp.fromDate(stored.createdAt),
    updatedAt: Timestamp.fromDate(stored.updatedAt),
    ...(stored.completedAt !== undefined ? { completedAt: Timestamp.fromDate(stored.completedAt) } : {}),
    [GOAL_CONTENT_FIELD]: encryptRecord(JSON.stringify(content), goalContext(owner, goalId)),
  };
}

/**
 * Decrypts the goal's content and merges it with the plaintext lifecycle fields. The domain parser then validates the
 * result. A tampered, substituted or malformed content envelope yields a document without `title`, so the parser refuses
 * it like any other invalid stored goal. Key configuration failures are rethrown, not hidden as invalid goals.
 */
function toRawGoalData(owner: string, goalId: string, data: Record<string, unknown>): RawGoalData {
  // Every key except the encrypted content is passed through, so unknown keys still reach the parser and fail closed.
  const lifecycle: Record<string, unknown> = Object.fromEntries(
    Object.entries(data)
      .filter(([key]) => key !== GOAL_CONTENT_FIELD)
      .map(([key, value]) => [key, value instanceof Timestamp ? value.toDate() : value]),
  );
  const content = openGoalContent(owner, goalId, data[GOAL_CONTENT_FIELD]);
  return content === null ? lifecycle : { ...lifecycle, ...content };
}

function openGoalContent(owner: string, goalId: string, value: unknown): Record<string, unknown> | null {
  const envelope = readRecordEnvelope(value);
  if (envelope === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(decryptRecord(envelope, goalContext(owner, goalId)));
  } catch (error) {
    if (error instanceof RecordEnvelopeError && error.code !== "authentication_failed" && error.code !== "malformed") {
      throw error;
    }
    return null;
  }
  return typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
}

/**
 * The Admin SDK implementation of {@link GoalStore} (server-only). Every operation builds its path from the
 * caller-supplied verified owner id; there is no query across owners. `generateId` is injectable (AD-6);
 * by default Firestore generates the auto-id. Firestore errors propagate unchanged.
 */
export function getDefaultGoalStore(options: { generateId?: () => string } = {}): GoalStore {
  return {
    async create(owner, goal) {
      const collection = goalsCollection(owner);
      const injectedId = options.generateId?.();
      if (injectedId !== undefined) assertGoalIdSegment(injectedId);
      const ref = injectedId !== undefined ? collection.doc(injectedId) : collection.doc();
      assertGoalIdSegment(ref.id);
      // The erasure fence is read first, in the same transaction (TASK-026, BR-4(b)).
      await runFencedTransaction(getFirestoreDb(), owner, async (tx) => {
        tx.create(ref, toFirestoreGoalData(owner, ref.id, goal));
      });
      return ref.id;
    },

    async listWindow(ownerUid) {
      const snapshot = await goalsCollection(ownerUid)
        .orderBy(CREATED_AT_FIELD, "desc")
        .limit(GOAL_RAW_READ_LIMIT)
        .get();
      return {
        docs: snapshot.docs
          .slice(0, GOAL_RAW_READ_LIMIT - 1)
          .map((doc) => ({ id: doc.id, data: toRawGoalData(ownerUid, doc.id, doc.data()) })),
        rawCount: snapshot.docs.length,
      };
    },

    async scanMissingCreatedAt(ownerUid) {
      const snapshot = await goalsCollection(ownerUid).select(CREATED_AT_FIELD).limit(GOAL_RAW_READ_LIMIT).get();
      return {
        missingCreatedAtIds: snapshot.docs
          .slice(0, GOAL_RAW_READ_LIMIT - 1)
          .filter((doc) => doc.data()[CREATED_AT_FIELD] === undefined)
          .map((doc) => doc.id),
        rawCount: snapshot.docs.length,
      };
    },

    async count(ownerUid) {
      const snapshot = await goalsCollection(ownerUid).count().get();
      return snapshot.data().count;
    },

    async get(ownerUid, goalId) {
      const snapshot = await goalRef(ownerUid, goalId).get();
      return snapshot.exists ? toRawGoalData(ownerUid, goalId, snapshot.data() ?? {}) : undefined;
    },

    async runTransaction(owner, goalId, work) {
      const ref = goalRef(owner, goalId);
      // The fence read precedes the goal read and every buffered write (TASK-026, BR-4(b)).
      return runFencedTransaction(getFirestoreDb(), owner, async (tx) => {
        let existed = false;
        return work({
          async read() {
            const snapshot = await tx.get(ref);
            existed = snapshot.exists;
            return snapshot.exists ? toRawGoalData(owner, goalId, snapshot.data() ?? {}) : undefined;
          },
          write(goal) {
            if (!existed) throw new Error("write to a goal that was not read as existing");
            tx.set(ref, toFirestoreGoalData(owner, goalId, goal));
          },
        });
      });
    },

    async delete(owner, goalId) {
      const ref = goalRef(owner, goalId);
      await runFencedTransaction(getFirestoreDb(), owner, async (tx) => {
        tx.delete(ref);
      });
    },
  };
}

import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
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
function toFirestoreGoalData(goal: Goal): Record<string, unknown> {
  const stored = toStoredGoalData(goal);
  return {
    title: stored.title,
    status: stored.status,
    createdAt: Timestamp.fromDate(stored.createdAt),
    updatedAt: Timestamp.fromDate(stored.updatedAt),
    ...(stored.treeId !== undefined ? { treeId: stored.treeId } : {}),
    ...(stored.targetDate !== undefined ? { targetDate: stored.targetDate } : {}),
    ...(stored.completedAt !== undefined ? { completedAt: Timestamp.fromDate(stored.completedAt) } : {}),
  };
}

/**
 * Maps top-level Firestore `Timestamp` values to `Date` so no Firestore type leaks past the store.
 * Everything else (strings, numbers, nulls, unknown keys) passes through untouched for the readability
 * parser to reject; nothing is repaired or normalised.
 */
function toRawGoalData(data: Record<string, unknown>): RawGoalData {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, value instanceof Timestamp ? value.toDate() : value]),
  );
}

/**
 * The Admin SDK implementation of {@link GoalStore} (server-only). Every operation builds its path from the
 * caller-supplied verified owner id; there is no query across owners. `generateId` is injectable (AD-6);
 * by default Firestore generates the auto-id. Firestore errors propagate unchanged.
 */
export function getDefaultGoalStore(options: { generateId?: () => string } = {}): GoalStore {
  return {
    async create(ownerUid, goal) {
      const collection = goalsCollection(ownerUid);
      const injectedId = options.generateId?.();
      if (injectedId !== undefined) assertGoalIdSegment(injectedId);
      const ref = injectedId !== undefined ? collection.doc(injectedId) : collection.doc();
      assertGoalIdSegment(ref.id);
      await ref.create(toFirestoreGoalData(goal));
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
          .map((doc) => ({ id: doc.id, data: toRawGoalData(doc.data()) })),
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
      return snapshot.exists ? toRawGoalData(snapshot.data() ?? {}) : undefined;
    },

    async runTransaction(ownerUid, goalId, work) {
      const ref = goalRef(ownerUid, goalId);
      return getFirestoreDb().runTransaction(async (tx) => {
        let existed = false;
        return work({
          async read() {
            const snapshot = await tx.get(ref);
            existed = snapshot.exists;
            return snapshot.exists ? toRawGoalData(snapshot.data() ?? {}) : undefined;
          },
          write(goal) {
            if (!existed) throw new Error("write to a goal that was not read as existing");
            tx.set(ref, toFirestoreGoalData(goal));
          },
        });
      });
    },

    async delete(ownerUid, goalId) {
      await goalRef(ownerUid, goalId).delete();
    },
  };
}

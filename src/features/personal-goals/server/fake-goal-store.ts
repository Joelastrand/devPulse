import { toStoredGoalData } from "../domain/goal";
import {
  GOAL_RAW_READ_LIMIT,
  InvalidGoalStoreKeyError,
  assertGoalIdSegment,
  assertOwnerSegment,
  type GoalStore,
  type RawGoalData,
  type RawGoalDoc,
} from "./goal-store-types";

/**
 * In-memory {@link GoalStore} for tests only; production modules must not import it (D1 scope guard).
 * Stored `Date` values stand for Firestore `Timestamp`s. It models the Firestore semantics operations rely
 * on: owner isolation, `orderBy` excluding documents whose field is absent, ordering by value type, the
 * implicit `__name__` tie-break in the same direction as the last `orderBy`, default id-ascending order
 * without `orderBy`, the 101-document bounded reads, and deleting without reading. It is not a general
 * Firestore emulator.
 */

type Doc = Record<string, unknown>;

// Documented Firestore cross-type order (not verified live): null < boolean < number < timestamp < string < array < map.
// Only null/number/timestamp/string matter to D1 (malformed `createdAt`); arrays and maps compare equal here and fall back to the id tie-break.
function typeOrder(value: unknown): number {
  if (value === null) return 0;
  if (typeof value === "boolean") return 1;
  if (typeof value === "number") return 2;
  if (value instanceof Date) return 3;
  if (typeof value === "string") return 4;
  if (Array.isArray(value)) return 5;
  return 6;
}

function compareValues(a: unknown, b: unknown): number {
  const byType = typeOrder(a) - typeOrder(b);
  if (byType !== 0) return byType;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "string" && typeof b === "string") return compareIds(a, b);
  return 0;
}

// Code-point order, which is Firestore's UTF-8 byte order for document ids and strings.
function compareIds(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    const diff = (left[i].codePointAt(0) ?? 0) - (right[i].codePointAt(0) ?? 0);
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

export interface FakeGoalStoreOptions {
  generateId?: () => string;
}

export function createFakeGoalStore(options: FakeGoalStoreOptions = {}) {
  const owners = new Map<string, Map<string, Doc>>();
  /** Ids passed to physical deletion, in call order (absent documents included). */
  const deletes: Array<{ ownerUid: string; goalId: string }> = [];
  /** Number of document reads performed by `get` and by transactions (deletes never read). */
  const reads = { count: 0 };
  let sequence = 0;

  const generateId =
    options.generateId ??
    (() => {
      sequence += 1;
      return `fakegoal${String(sequence).padStart(12, "0")}`;
    });

  function ownerDocs(ownerUid: string): Map<string, Doc> {
    assertOwnerSegment(ownerUid);
    let docs = owners.get(ownerUid);
    if (!docs) {
      docs = new Map();
      owners.set(ownerUid, docs);
    }
    return docs;
  }

  const raw = (id: string, doc: Doc): RawGoalDoc => ({ id, data: structuredClone(doc) });
  const ascendingById = (docs: Map<string, Doc>) => [...docs.entries()].sort(([a], [b]) => compareIds(a, b));

  const store: GoalStore = {
    async create(ownerUid, goal) {
      const docs = ownerDocs(ownerUid);
      const id = generateId();
      assertGoalIdSegment(id);
      if (docs.has(id)) throw new Error("document already exists");
      docs.set(id, structuredClone({ ...toStoredGoalData(goal) }));
      return id;
    },

    async listWindow(ownerUid) {
      // orderBy("createdAt", "desc"): absent field excluded; implicit __name__ desc breaks ties.
      const ordered = [...ownerDocs(ownerUid).entries()]
        .filter(([, doc]) => doc.createdAt !== undefined)
        .sort(([idA, a], [idB, b]) => compareValues(b.createdAt, a.createdAt) || compareIds(idB, idA))
        .slice(0, GOAL_RAW_READ_LIMIT);
      return {
        docs: ordered.slice(0, GOAL_RAW_READ_LIMIT - 1).map(([id, doc]) => raw(id, doc)),
        rawCount: ordered.length,
      };
    },

    async scanMissingCreatedAt(ownerUid) {
      // select("createdAt").limit(101), default __name__ ascending; only createdAt presence is observable.
      const window = ascendingById(ownerDocs(ownerUid)).slice(0, GOAL_RAW_READ_LIMIT);
      return {
        missingCreatedAtIds: window
          .slice(0, GOAL_RAW_READ_LIMIT - 1)
          .filter(([, doc]) => doc.createdAt === undefined)
          .map(([id]) => id),
        rawCount: window.length,
      };
    },

    async count(ownerUid) {
      return ownerDocs(ownerUid).size;
    },

    async get(ownerUid, goalId) {
      assertGoalIdSegment(goalId);
      reads.count += 1;
      const doc = ownerDocs(ownerUid).get(goalId);
      return doc && raw(goalId, doc).data;
    },

    async runTransaction(ownerUid, goalId, work) {
      assertGoalIdSegment(goalId);
      const docs = ownerDocs(ownerUid);
      let existed = false;
      let pending: Doc | undefined;
      const result = await work({
        async read() {
          // Firestore rejects a transaction read issued after a write.
          if (pending) throw new Error("transaction read after write");
          reads.count += 1;
          const doc = docs.get(goalId);
          existed = doc !== undefined;
          return doc && raw(goalId, doc).data;
        },
        write(goal) {
          if (!existed) throw new Error("write to a goal that was not read as existing");
          pending = structuredClone({ ...toStoredGoalData(goal) });
        },
      });
      // Buffered like Firestore: nothing is applied if `work` rejects.
      if (pending) docs.set(goalId, pending);
      return result;
    },

    async delete(ownerUid, goalId) {
      assertGoalIdSegment(goalId);
      deletes.push({ ownerUid, goalId });
      ownerDocs(ownerUid).delete(goalId);
    },
  };

  return {
    store,
    deletes,
    reads,
    /** Test-only: places raw document data (any shape, `Date` = Timestamp) under an owner, bypassing the store contract. */
    seed(ownerUid: string, goalId: string, data: RawGoalData): void {
      if (typeof goalId !== "string" || goalId.length === 0) throw new InvalidGoalStoreKeyError();
      ownerDocs(ownerUid).set(goalId, structuredClone(data) as Doc);
    },
    /** Test-only: the raw stored document, or `undefined`. */
    peek(ownerUid: string, goalId: string): RawGoalData | undefined {
      const doc = ownerDocs(ownerUid).get(goalId);
      return doc && structuredClone(doc);
    },
    /** Test-only: all stored ids of an owner in id order. */
    ids(ownerUid: string): string[] {
      return ascendingById(ownerDocs(ownerUid)).map(([id]) => id);
    },
  };
}

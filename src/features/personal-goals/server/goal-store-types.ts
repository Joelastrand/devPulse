import { GOAL_READ_WINDOW, isAddressableGoalId } from "../domain/goal-constants";
import type { Goal } from "../domain/goal";

/**
 * Persistence contract for `Goal` documents (TASK-004). Pure types and helpers shared by the Admin SDK
 * store and the in-memory fake; imports nothing from Firebase so the fake stays Firebase-free.
 *
 * The store is a persistence boundary only: it returns raw material and never classifies, repairs,
 * authorizes or maps errors. Every method takes the verified owner id of the caller as its first argument.
 */

/** Raw stored document data with top-level Firestore `Timestamp`s already mapped to `Date`; never validated. */
export type RawGoalData = Record<string, unknown>;

export interface RawGoalDoc {
  id: string;
  data: RawGoalData;
}

/** Size of each bounded raw read: the 100-document window plus one truncation probe (BR-30, BR-32, BR-58). */
export const GOAL_RAW_READ_LIMIT = GOAL_READ_WINDOW + 1;

/**
 * Result of the BR-30 list query. `docs` is the candidate window (at most the first 100 raw documents, in
 * query order); the probe document is never returned. `rawCount` is what the query returned (at most 101).
 */
export interface GoalListWindow {
  docs: RawGoalDoc[];
  rawCount: number;
}

/**
 * Result of the BR-58 recovery scan. `missingCreatedAtIds` are the ids, within the first 100 raw
 * documents, whose `createdAt` field is absent (id order). `rawCount` is what the scan returned (at most
 * 101). No stored content other than that absence is read.
 */
export interface GoalRecoveryScan {
  missingCreatedAtIds: string[];
  rawCount: number;
}

/** One transaction on a single goal document (BR-29). Reads precede the buffered write. */
export interface GoalTransaction {
  /** Raw stored data, or `undefined` when the document is absent. */
  read(): Promise<RawGoalData | undefined>;
  /** Replaces the existing document with the canonical persisted keys of `goal`. Only valid after `read()` found it. */
  write(goal: Goal): void;
}

export interface GoalStore {
  /** Creates a new document with a generated id (never overwrites) and returns the id. */
  create(ownerUid: string, goal: Goal): Promise<string>;
  /** `orderBy("createdAt", "desc").limit(101)` window (BR-30). */
  listWindow(ownerUid: string): Promise<GoalListWindow>;
  /** `select("createdAt").limit(101)` scan without `orderBy` (BR-58). */
  scanMissingCreatedAt(ownerUid: string): Promise<GoalRecoveryScan>;
  /** Number of all documents in the owner's goals subcollection, malformed and missing-`createdAt` included (BR-34). */
  count(ownerUid: string): Promise<number>;
  /** Raw stored data, or `undefined` when absent. A read failure rejects; it is never reported as absence. */
  get(ownerUid: string, goalId: string): Promise<RawGoalData | undefined>;
  /** Runs `work` in one Firestore transaction on the single document; Firestore may re-run `work`. */
  runTransaction<T>(ownerUid: string, goalId: string, work: (tx: GoalTransaction) => Promise<T>): Promise<T>;
  /** Physically deletes the document without reading or parsing it; succeeds when it is absent. */
  delete(ownerUid: string, goalId: string): Promise<void>;
}

/** A path segment the store refuses to build a document path from. Carries no id and no content. */
export class InvalidGoalStoreKeyError extends Error {
  constructor() {
    super("invalid goal store key");
    this.name = "InvalidGoalStoreKeyError";
  }
}

// Owner ids Firestore would reject or that would change the path shape.
function isSafeOwnerSegment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("/") &&
    value !== "." &&
    value !== ".." &&
    !/^__.*__$/.test(value)
  );
}

export function assertOwnerSegment(ownerUid: unknown): asserts ownerUid is string {
  if (!isSafeOwnerSegment(ownerUid)) throw new InvalidGoalStoreKeyError();
}

/** Goal ids must satisfy the domain's single addressability rule (BR-27a, BR-63) before they reach a document path. */
export function assertGoalIdSegment(goalId: unknown): asserts goalId is string {
  if (!isAddressableGoalId(goalId)) throw new InvalidGoalStoreKeyError();
}

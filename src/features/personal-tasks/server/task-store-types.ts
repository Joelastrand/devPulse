import type { CompletedVisibility, PersonalTask, TaskValidationError } from "../domain/task";

/** Every error a task operation can return. Content-free: no raw store or crypto detail ever reaches a caller. */
export type TaskOperationError =
  | TaskValidationError
  | "not_found"
  | "task_limit"
  | "invalid_cursor"
  | "erasure_in_progress"
  | "persistence_failed";

export interface TaskPreferences {
  completedVisibility: CompletedVisibility;
}

/**
 * Result of the transactional work function. `writes` are complete task documents to store, `deletes` are task ids to
 * remove. A plan with `ok: false` writes nothing.
 */
export type TaskTransactionPlan<T> =
  | { ok: false; error: TaskOperationError }
  | { ok: true; writes: PersonalTask[]; deletes: string[]; result: T };

export type TaskTransactionOutcome<T> = { ok: false; error: TaskOperationError } | { ok: true; result: T };

/**
 * Persistence port for one owner's personal tasks. Every method takes the verified owner uid; there is no cross-owner
 * access. `transact` reads the owner's whole board inside the same transaction as its writes, so position decisions
 * are made on the data that is then written (no lost update between two concurrent moves). Implementations must run
 * the erasure fence in that transaction. Thrown errors mean "outcome unknown or failed" and map to `persistence_failed`.
 */
export interface PersonalTaskStore {
  /** The owner's whole board, bounded by `TASK_LIMITS.maxTasks`. */
  list(ownerUid: string): Promise<PersonalTask[]>;
  transact<T>(
    ownerUid: string,
    work: (board: readonly PersonalTask[]) => TaskTransactionPlan<T>,
  ): Promise<TaskTransactionOutcome<T>>;
  getPreferences(ownerUid: string): Promise<TaskPreferences>;
  setPreferences(ownerUid: string, preferences: TaskPreferences): Promise<void>;
}

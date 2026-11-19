import { DEFAULT_COMPLETED_VISIBILITY, compareTasks, type PersonalTask } from "../domain/task";
import type { PersonalTaskStore, TaskPreferences } from "./task-store-types";

/**
 * In-memory {@link PersonalTaskStore} for tests. It follows the port contract: `transact` runs the work on the owner's
 * current board and commits the plan's writes only when the plan succeeds. Owners are isolated by key. It does not
 * encrypt; the codec is tested against the real store module separately.
 */
export interface FakeTaskStore extends PersonalTaskStore {
  /** Makes the next `transact` or `list` reject, to simulate a storage failure. */
  failNext(): void;
  /** Direct view for assertions: an owner's stored tasks. */
  stored(ownerUid: string): PersonalTask[];
}

export function createFakeTaskStore(): FakeTaskStore {
  const boards = new Map<string, Map<string, PersonalTask>>();
  const preferences = new Map<string, TaskPreferences>();
  let failures = 0;

  function boardOf(owner: string): Map<string, PersonalTask> {
    let board = boards.get(owner);
    if (!board) {
      board = new Map();
      boards.set(owner, board);
    }
    return board;
  }

  function maybeFail(): void {
    if (failures > 0) {
      failures -= 1;
      throw new Error("simulated storage failure");
    }
  }

  return {
    failNext() {
      failures += 1;
    },
    stored(owner) {
      return [...boardOf(owner).values()].sort(compareTasks);
    },
    async list(owner) {
      maybeFail();
      return [...boardOf(owner).values()].map((task) => ({ ...task })).sort(compareTasks);
    },
    async transact(owner, work) {
      maybeFail();
      const board = boardOf(owner);
      const snapshot = [...board.values()].map((task) => ({ ...task }));
      const plan = work(snapshot);
      if (!plan.ok) return { ok: false, error: plan.error };
      for (const id of plan.deletes) board.delete(id);
      for (const task of plan.writes) board.set(task.id, { ...task });
      return { ok: true, result: plan.result };
    },
    async getPreferences(owner) {
      maybeFail();
      return preferences.get(owner) ?? { completedVisibility: DEFAULT_COMPLETED_VISIBILITY };
    },
    async setPreferences(owner, value) {
      maybeFail();
      preferences.set(owner, { ...value });
    },
  };
}

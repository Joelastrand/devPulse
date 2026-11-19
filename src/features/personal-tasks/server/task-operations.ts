import "server-only";
import { randomUUID } from "node:crypto";
import {
  applyTaskFields,
  compareHistory,
  compareTasks,
  DEFAULT_COMPLETED_VISIBILITY,
  isAfterHistoryPosition,
  isTaskId,
  isTaskOnBoard,
  parseCompletedVisibilityBody,
  parseCreateTaskBody,
  parseUpdateTaskBody,
  TASK_LIMITS,
  toTaskDto,
  type HistoryPosition,
  type PersonalTask,
  type TaskDto,
  type UpdateTaskPatch,
} from "../domain/task";
import { placeTask } from "../domain/task-ordering";
import { writeRefusalFor } from "../../auth/server/erasure-write-fence";
import { getDefaultPersonalTaskStore } from "./task-store";
import type { PersonalTaskStore, TaskOperationError, TaskPreferences } from "./task-store-types";

export interface TaskOperationDeps {
  store: PersonalTaskStore;
  now: () => Date;
  newId: () => string;
}

export type TaskResult<T> = { ok: true; value: T } | { ok: false; error: TaskOperationError };

function defaultDeps(): TaskOperationDeps {
  return { store: getDefaultPersonalTaskStore(), now: () => new Date(), newId: () => randomUUID() };
}

/** Maps a thrown store failure to the public error. The raw error is never returned. */
function failureFor(error: unknown): TaskOperationError {
  return writeRefusalFor(error);
}

/** Creates a task in the chosen column (default backlog), at the end of that column. */
export async function createPersonalTask(
  ownerUid: string,
  body: unknown,
  deps: TaskOperationDeps = defaultDeps(),
): Promise<TaskResult<TaskDto>> {
  const parsed = parseCreateTaskBody(body);
  if (!parsed.ok) return parsed;
  const input = parsed.input;
  try {
    const outcome = await deps.store.transact(ownerUid, (board) => {
      if (board.length >= TASK_LIMITS.maxTasks) return { ok: false, error: "task_limit" };
      const now = deps.now();
      const draft: PersonalTask = {
        id: deps.newId(),
        title: input.title,
        description: input.description,
        notes: input.notes,
        status: input.status,
        priority: input.priority,
        dueDate: input.dueDate,
        position: 0,
        createdAt: now,
        updatedAt: now,
        completedAt: input.status === "done" ? now : null,
      };
      const column = board.filter((task) => task.status === input.status);
      const placed = placeTask(draft, column, null);
      if (!placed.ok) return { ok: false, error: "invalid_position" };
      const created = placed.tasks.find((task) => task.id === draft.id);
      if (!created) return { ok: false, error: "persistence_failed" };
      return { ok: true, writes: placed.tasks, deletes: [], result: toTaskDto(created) };
    });
    return outcome.ok ? { ok: true, value: outcome.result } : outcome;
  } catch (error) {
    return { ok: false, error: failureFor(error) };
  }
}

/**
 * Edits one task. Fields absent from the patch are unchanged. A patch with `status` places the task in that column:
 * before `beforeTaskId`, or at the end when it is `null` or absent. Setting the status a task already has moves it
 * to the end of its column, so a field-only edit must not send `status`.
 */
export async function updatePersonalTask(
  ownerUid: string,
  taskId: string,
  body: unknown,
  deps: TaskOperationDeps = defaultDeps(),
): Promise<TaskResult<TaskDto>> {
  if (!isTaskId(taskId)) return { ok: false, error: "not_found" };
  const parsed = parseUpdateTaskBody(body);
  if (!parsed.ok) return parsed;
  const patch: UpdateTaskPatch = parsed.patch;
  try {
    const outcome = await deps.store.transact(ownerUid, (board) => {
      const current = board.find((task) => task.id === taskId);
      if (!current) return { ok: false, error: "not_found" };
      const updated = applyTaskFields(current, patch, deps.now());
      if (patch.status === undefined) {
        return { ok: true, writes: [updated], deletes: [], result: toTaskDto(updated) };
      }
      const column = board.filter((task) => task.status === patch.status && task.id !== taskId);
      const placed = placeTask(updated, column, patch.beforeTaskId ?? null);
      if (!placed.ok) return { ok: false, error: "invalid_position" };
      const saved = placed.tasks.find((task) => task.id === taskId);
      if (!saved) return { ok: false, error: "persistence_failed" };
      return { ok: true, writes: placed.tasks, deletes: [], result: toTaskDto(saved) };
    });
    return outcome.ok ? { ok: true, value: outcome.result } : outcome;
  } catch (error) {
    return { ok: false, error: failureFor(error) };
  }
}

/** Permanently deletes one task. Idempotent: deleting an absent task succeeds. Completed tasks are never auto-deleted. */
export async function deletePersonalTask(
  ownerUid: string,
  taskId: string,
  deps: TaskOperationDeps = defaultDeps(),
): Promise<TaskResult<null>> {
  if (!isTaskId(taskId)) return { ok: false, error: "not_found" };
  try {
    const outcome = await deps.store.transact(ownerUid, () => ({
      ok: true,
      writes: [],
      deletes: [taskId],
      result: null,
    }));
    return outcome.ok ? { ok: true, value: null } : outcome;
  } catch (error) {
    return { ok: false, error: failureFor(error) };
  }
}

export interface PersonalTaskBoard {
  tasks: TaskDto[];
  completedVisibility: TaskPreferences["completedVisibility"];
}

/**
 * The owner's board: active tasks and the completed tasks that the preference keeps visible, in column order. The
 * visibility rule is applied here, on the server, so hidden completed tasks are not sent to the browser at all.
 */
export async function listPersonalTaskBoard(
  ownerUid: string,
  deps: TaskOperationDeps = defaultDeps(),
): Promise<TaskResult<PersonalTaskBoard>> {
  try {
    const [board, preferences] = await Promise.all([deps.store.list(ownerUid), deps.store.getPreferences(ownerUid)]);
    const nowMs = deps.now().getTime();
    const visible = board
      .filter((task) => isTaskOnBoard(task, preferences.completedVisibility, nowMs))
      .sort(compareTasks);
    return {
      ok: true,
      value: { tasks: visible.map(toTaskDto), completedVisibility: preferences.completedVisibility },
    };
  } catch (error) {
    return { ok: false, error: failureFor(error) };
  }
}

export interface PersonalTaskHistoryPage {
  tasks: TaskDto[];
  nextCursor: string | null;
}

/** Clamp the requested page size; an unusable value falls back to the default, never to "all". */
export function clampHistoryLimit(raw: unknown): number {
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return TASK_LIMITS.historyPageDefault;
  return Math.min(value, TASK_LIMITS.historyPageMax);
}

export function encodeHistoryCursor(task: PersonalTask): string {
  const payload = JSON.stringify({ t: task.completedAt?.getTime() ?? 0, id: task.id });
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function decodeHistoryCursor(raw: string): HistoryPosition | null {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(raw)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { t, id } = parsed as Record<string, unknown>;
  if (typeof t !== "number" || !Number.isSafeInteger(t) || !isTaskId(id)) return null;
  return { completedAtMs: t, id };
}

/**
 * Completed tasks, newest first, one page at a time. Every completed task is listed here, including those hidden
 * from the board. The page size is bounded; an absent cursor starts at the newest item.
 */
export async function listPersonalTaskHistory(
  ownerUid: string,
  options: { cursor?: string | null; limit?: unknown } = {},
  deps: TaskOperationDeps = defaultDeps(),
): Promise<TaskResult<PersonalTaskHistoryPage>> {
  let cursor: HistoryPosition | null = null;
  if (options.cursor !== undefined && options.cursor !== null) {
    cursor = decodeHistoryCursor(options.cursor);
    if (cursor === null) return { ok: false, error: "invalid_cursor" };
  }
  const limit = clampHistoryLimit(options.limit);
  try {
    // The board is bounded (TASK_LIMITS.maxTasks), so history is read as one bounded list and paged in memory.
    const completed = (await deps.store.list(ownerUid))
      .filter((task) => task.completedAt !== null)
      .sort(compareHistory)
      .filter((task) => cursor === null || isAfterHistoryPosition(task, cursor));
    const page = completed.slice(0, limit);
    const last = page[page.length - 1];
    return {
      ok: true,
      value: {
        tasks: page.map(toTaskDto),
        nextCursor: completed.length > limit && last ? encodeHistoryCursor(last) : null,
      },
    };
  } catch (error) {
    return { ok: false, error: failureFor(error) };
  }
}

export async function getPersonalTaskPreferences(
  ownerUid: string,
  deps: TaskOperationDeps = defaultDeps(),
): Promise<TaskResult<TaskPreferences>> {
  try {
    return { ok: true, value: await deps.store.getPreferences(ownerUid) };
  } catch (error) {
    return { ok: false, error: failureFor(error) };
  }
}

/** Sets the board preference for completed tasks. Stored encrypted; never in browser storage. */
export async function setPersonalTaskPreferences(
  ownerUid: string,
  body: unknown,
  deps: TaskOperationDeps = defaultDeps(),
): Promise<TaskResult<TaskPreferences>> {
  const parsed = parseCompletedVisibilityBody(body);
  if (!parsed.ok) return parsed;
  const preferences: TaskPreferences = { completedVisibility: parsed.value };
  try {
    await deps.store.setPreferences(ownerUid, preferences);
    return { ok: true, value: preferences };
  } catch (error) {
    return { ok: false, error: failureFor(error) };
  }
}

export const DEFAULT_TASK_PREFERENCES: TaskPreferences = { completedVisibility: DEFAULT_COMPLETED_VISIBILITY };

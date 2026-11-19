import {
  isCompletedVisibility,
  isTaskPriority,
  isTaskStatus,
  type CompletedVisibility,
  type TaskDto,
  type UpdateTaskPatch,
  type CreateTaskInput,
} from "../domain/task";

/**
 * Browser gateway for the signed-in person's own task board (Mine oppgaver). Thin `fetch` wrappers around
 * `/api/me/tasks`. The subject is only the token's identity; no uid is ever sent. Browser code never touches Firestore.
 * Every response is parsed fail-closed: an unexpected shape is a read failure, never partially rendered data.
 */

export interface TaskBoardData {
  tasks: TaskDto[];
  completedVisibility: CompletedVisibility;
}

export type FetchBoardResult = { status: "ok"; board: TaskBoardData } | { status: "unauthenticated" | "read_failed" };

export interface TaskHistoryPageData {
  tasks: TaskDto[];
  nextCursor: string | null;
}

export type FetchHistoryResult =
  | { status: "ok"; page: TaskHistoryPageData }
  | { status: "unauthenticated" | "read_failed" };

/** `unauthenticated` ends the session view. `error` carries a known server code or `unknown`; nothing is retried. */
export type TaskMutationResult =
  | { status: "ok"; task: TaskDto }
  | { status: "unauthenticated" }
  | { status: "error"; error: string };

export type TaskDeleteResult = { status: "ok" } | { status: "unauthenticated" } | { status: "error"; error: string };

const TASKS_URL = "/api/me/tasks";
const HISTORY_URL = "/api/me/tasks/history";
const PREFERENCES_URL = "/api/me/tasks/preferences";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isNullableString = (value: unknown): value is string | null => value === null || typeof value === "string";

export function parseTaskDto(value: unknown): TaskDto | undefined {
  if (!isRecord(value)) return undefined;
  const { id, title, description, notes, status, priority, dueDate, position, createdAt, updatedAt, completedAt } = value;
  if (typeof id !== "string" || id === "" || typeof title !== "string") return undefined;
  if (!isNullableString(description) || !isNullableString(notes) || !isNullableString(dueDate)) return undefined;
  if (!isTaskStatus(status)) return undefined;
  if (priority !== null && !isTaskPriority(priority)) return undefined;
  if (typeof position !== "number" || !Number.isFinite(position)) return undefined;
  if (typeof createdAt !== "string" || typeof updatedAt !== "string" || !isNullableString(completedAt)) return undefined;
  // The completion invariant (domain): completedAt is present exactly when the task is done.
  if ((status === "done") !== (completedAt !== null)) return undefined;
  return { id, title, description, notes, status, priority, dueDate, position, createdAt, updatedAt, completedAt };
}

function parseBoard(body: unknown): TaskBoardData | undefined {
  if (!isRecord(body) || !Array.isArray(body.tasks) || !isCompletedVisibility(body.completedVisibility)) return undefined;
  const tasks: TaskDto[] = [];
  for (const item of body.tasks) {
    const task = parseTaskDto(item);
    if (!task) return undefined;
    tasks.push(task);
  }
  return { tasks, completedVisibility: body.completedVisibility };
}

function parseHistory(body: unknown): TaskHistoryPageData | undefined {
  if (!isRecord(body) || !Array.isArray(body.tasks) || !isNullableString(body.nextCursor)) return undefined;
  const tasks: TaskDto[] = [];
  for (const item of body.tasks) {
    const task = parseTaskDto(item);
    if (!task) return undefined;
    tasks.push(task);
  }
  return { tasks, nextCursor: body.nextCursor };
}

function errorCodeOf(payload: unknown): string {
  return isRecord(payload) && typeof payload.error === "string" ? payload.error : "unknown";
}

export async function fetchTaskBoard(idToken: string): Promise<FetchBoardResult> {
  try {
    const response = await fetch(TASKS_URL, { headers: { Authorization: `Bearer ${idToken}` } });
    if (response.status === 401) return { status: "unauthenticated" };
    if (response.status !== 200) return { status: "read_failed" };
    const board = parseBoard(await response.json());
    return board ? { status: "ok", board } : { status: "read_failed" };
  } catch {
    return { status: "read_failed" };
  }
}

export async function fetchTaskHistory(
  idToken: string,
  options: { cursor: string | null; limit: number },
): Promise<FetchHistoryResult> {
  try {
    const params = new URLSearchParams({ limit: String(options.limit) });
    if (options.cursor !== null) params.set("cursor", options.cursor);
    const response = await fetch(`${HISTORY_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (response.status === 401) return { status: "unauthenticated" };
    if (response.status !== 200) return { status: "read_failed" };
    const page = parseHistory(await response.json());
    return page ? { status: "ok", page } : { status: "read_failed" };
  } catch {
    return { status: "read_failed" };
  }
}

async function sendTaskRequest(
  url: string,
  method: "POST" | "PATCH",
  idToken: string,
  body: CreateTaskInput | UpdateTaskPatch,
  successStatus: number,
): Promise<TaskMutationResult> {
  try {
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 401) return { status: "unauthenticated" };
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { status: "error", error: "unknown" };
    }
    if (response.status === successStatus) {
      const task = parseTaskDto(payload);
      return task ? { status: "ok", task } : { status: "error", error: "unknown" };
    }
    return { status: "error", error: errorCodeOf(payload) };
  } catch {
    return { status: "error", error: "unknown" };
  }
}

export function createTask(idToken: string, input: CreateTaskInput): Promise<TaskMutationResult> {
  return sendTaskRequest(TASKS_URL, "POST", idToken, input, 201);
}

export function updateTask(idToken: string, taskId: string, patch: UpdateTaskPatch): Promise<TaskMutationResult> {
  return sendTaskRequest(`${TASKS_URL}/${encodeURIComponent(taskId)}`, "PATCH", idToken, patch, 200);
}

/** Permanently deletes one own task. Idempotent on the server; an unconfirmed result is reported as an error. */
export async function deleteTask(idToken: string, taskId: string): Promise<TaskDeleteResult> {
  try {
    const response = await fetch(`${TASKS_URL}/${encodeURIComponent(taskId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (response.status === 401) return { status: "unauthenticated" };
    if (response.status !== 200) return { status: "error", error: errorCodeOf(await safeJson(response)) };
    const payload = await safeJson(response);
    return isRecord(payload) && payload.ok === true ? { status: "ok" } : { status: "error", error: "unknown" };
  } catch {
    return { status: "error", error: "unknown" };
  }
}

export async function saveCompletedVisibility(
  idToken: string,
  value: CompletedVisibility,
): Promise<{ status: "ok" } | { status: "unauthenticated" } | { status: "error"; error: string }> {
  try {
    const response = await fetch(PREFERENCES_URL, {
      method: "PUT",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ completedVisibility: value }),
    });
    if (response.status === 401) return { status: "unauthenticated" };
    if (response.status !== 200) return { status: "error", error: errorCodeOf(await safeJson(response)) };
    return { status: "ok" };
  } catch {
    return { status: "error", error: "unknown" };
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

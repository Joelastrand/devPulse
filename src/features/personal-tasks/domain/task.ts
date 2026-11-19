/**
 * Personal Kanban tasks (Mine oppgaver): the domain model, runtime validation of untrusted input, and the board and
 * history visibility rules. Pure: no Firestore, no encryption, no clock. Callers pass `now` explicitly.
 *
 * Invariant: `completedAt` is set exactly when `status` is `done`. Only the domain functions below change `status`, so
 * the invariant is held in one place.
 */

export const TASK_STATUSES = ["backlog", "doing", "blocked", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const COMPLETED_VISIBILITIES = ["last7", "all", "hidden"] as const;
export type CompletedVisibility = (typeof COMPLETED_VISIBILITIES)[number];

/**
 * Limits. Nothing is truncated silently: input over a limit is refused with a specific error, and the board refuses
 * creation at `maxTasks` instead of dropping tasks from its read.
 */
export const TASK_LIMITS = {
  titleMax: 160,
  descriptionMax: 5000,
  notesMax: 10000,
  maxTasks: 500,
  historyPageDefault: 25,
  historyPageMax: 50,
} as const;

/** A completed task stays on the board for this long when the preference is `last7` (default). */
export const DONE_BOARD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const DEFAULT_COMPLETED_VISIBILITY: CompletedVisibility = "last7";

/** Stable id for a task document: UUID-like, bounded, no path characters. */
const TASK_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isTaskId(value: unknown): value is string {
  return typeof value === "string" && TASK_ID_PATTERN.test(value);
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value);
}

export function isCompletedVisibility(value: unknown): value is CompletedVisibility {
  return typeof value === "string" && (COMPLETED_VISIBILITIES as readonly string[]).includes(value);
}

export interface PersonalTask {
  id: string;
  title: string;
  description: string | null;
  notes: string | null;
  status: TaskStatus;
  priority: TaskPriority | null;
  /** Calendar date `YYYY-MM-DD`, never a timestamp, so no timezone can shift it. */
  dueDate: string | null;
  /** Fractional ordering key within the task's status column. Compared numerically; ties broken by id. */
  position: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export type TaskValidationError =
  | "invalid_request"
  | "invalid_title"
  | "invalid_description"
  | "invalid_notes"
  | "invalid_status"
  | "invalid_priority"
  | "invalid_due_date"
  | "invalid_position"
  | "invalid_visibility";

type FieldResult<T> = { ok: true; value: T } | { ok: false; error: TaskValidationError };

/** Trimmed, 1..max characters. Empty or whitespace-only is refused, never stored. */
export function normalizeTitle(raw: unknown): FieldResult<string> {
  if (typeof raw !== "string") return { ok: false, error: "invalid_title" };
  const title = raw.trim();
  if (title.length === 0 || title.length > TASK_LIMITS.titleMax) return { ok: false, error: "invalid_title" };
  return { ok: true, value: title };
}

/** Optional multiline text: absent or `null` is `null`; whitespace-only is `null`; over the limit is refused. */
export function normalizeOptionalText(
  raw: unknown,
  max: number,
  error: "invalid_description" | "invalid_notes",
): FieldResult<string | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error };
  const text = raw.trim();
  if (text.length === 0) return { ok: true, value: null };
  if (text.length > max) return { ok: false, error };
  return { ok: true, value: text };
}

/** A real calendar date in `YYYY-MM-DD` form. Checked by a UTC round trip, so `2026-02-30` is refused. */
export function isValidDueDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function normalizeDueDate(raw: unknown): FieldResult<string | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  return isValidDueDate(raw) ? { ok: true, value: raw } : { ok: false, error: "invalid_due_date" };
}

function normalizePriority(raw: unknown): FieldResult<TaskPriority | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  return isTaskPriority(raw) ? { ok: true, value: raw } : { ok: false, error: "invalid_priority" };
}

function normalizeStatus(raw: unknown): FieldResult<TaskStatus> {
  return isTaskStatus(raw) ? { ok: true, value: raw } : { ok: false, error: "invalid_status" };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export interface CreateTaskInput {
  title: string;
  description: string | null;
  notes: string | null;
  priority: TaskPriority | null;
  dueDate: string | null;
  status: TaskStatus;
}

const CREATE_KEYS = ["title", "description", "notes", "priority", "dueDate", "status"] as const;

/** Create body (BR: unknown keys are refused, ownership is never accepted from the client). Defaults: backlog, no extras. */
export function parseCreateTaskBody(body: unknown): { ok: true; input: CreateTaskInput } | { ok: false; error: TaskValidationError } {
  if (!isPlainObject(body) || !hasOnlyKeys(body, CREATE_KEYS)) return { ok: false, error: "invalid_request" };
  const title = normalizeTitle(body.title);
  if (!title.ok) return title;
  const description = normalizeOptionalText(body.description, TASK_LIMITS.descriptionMax, "invalid_description");
  if (!description.ok) return description;
  const notes = normalizeOptionalText(body.notes, TASK_LIMITS.notesMax, "invalid_notes");
  if (!notes.ok) return notes;
  const priority = normalizePriority(body.priority);
  if (!priority.ok) return priority;
  const dueDate = normalizeDueDate(body.dueDate);
  if (!dueDate.ok) return dueDate;
  const status = body.status === undefined ? { ok: true as const, value: "backlog" as TaskStatus } : normalizeStatus(body.status);
  if (!status.ok) return status;
  return {
    ok: true,
    input: {
      title: title.value,
      description: description.value,
      notes: notes.value,
      priority: priority.value,
      dueDate: dueDate.value,
      status: status.value,
    },
  };
}

/**
 * Patch body. Absent keys are unchanged. `null` clears an optional field. `status` present means "place this task in that
 * column"; `beforeTaskId` (only with `status`) names the task it goes in front of, or `null` for the end of the column.
 */
export interface UpdateTaskPatch {
  title?: string;
  description?: string | null;
  notes?: string | null;
  priority?: TaskPriority | null;
  dueDate?: string | null;
  status?: TaskStatus;
  beforeTaskId?: string | null;
}

const UPDATE_KEYS = ["title", "description", "notes", "priority", "dueDate", "status", "beforeTaskId"] as const;

export function parseUpdateTaskBody(body: unknown): { ok: true; patch: UpdateTaskPatch } | { ok: false; error: TaskValidationError } {
  if (!isPlainObject(body) || !hasOnlyKeys(body, UPDATE_KEYS) || Object.keys(body).length === 0) {
    return { ok: false, error: "invalid_request" };
  }
  const patch: UpdateTaskPatch = {};
  if (body.title !== undefined) {
    const title = normalizeTitle(body.title);
    if (!title.ok) return title;
    patch.title = title.value;
  }
  if (body.description !== undefined) {
    const description = normalizeOptionalText(body.description, TASK_LIMITS.descriptionMax, "invalid_description");
    if (!description.ok) return description;
    patch.description = description.value;
  }
  if (body.notes !== undefined) {
    const notes = normalizeOptionalText(body.notes, TASK_LIMITS.notesMax, "invalid_notes");
    if (!notes.ok) return notes;
    patch.notes = notes.value;
  }
  if (body.priority !== undefined) {
    const priority = normalizePriority(body.priority);
    if (!priority.ok) return priority;
    patch.priority = priority.value;
  }
  if (body.dueDate !== undefined) {
    const dueDate = normalizeDueDate(body.dueDate);
    if (!dueDate.ok) return dueDate;
    patch.dueDate = dueDate.value;
  }
  if (body.status !== undefined) {
    const status = normalizeStatus(body.status);
    if (!status.ok) return status;
    patch.status = status.value;
  }
  if (body.beforeTaskId !== undefined) {
    // Placement belongs to a status change; a reorder without a status is not a separate operation.
    if (body.status === undefined) return { ok: false, error: "invalid_request" };
    if (body.beforeTaskId !== null && !isTaskId(body.beforeTaskId)) return { ok: false, error: "invalid_position" };
    patch.beforeTaskId = body.beforeTaskId;
  }
  return { ok: true, patch };
}

/**
 * Applies a patch to a task, returning the new task. Enforces the `completedAt` invariant: entering `done` sets it to
 * `now` (server clock), leaving `done` clears it, and staying in `done` keeps the original completion time.
 */
export function applyTaskFields(task: PersonalTask, patch: UpdateTaskPatch, now: Date): PersonalTask {
  const next: PersonalTask = {
    ...task,
    title: patch.title ?? task.title,
    description: patch.description !== undefined ? patch.description : task.description,
    notes: patch.notes !== undefined ? patch.notes : task.notes,
    priority: patch.priority !== undefined ? patch.priority : task.priority,
    dueDate: patch.dueDate !== undefined ? patch.dueDate : task.dueDate,
    status: patch.status ?? task.status,
    updatedAt: now,
    completedAt: task.completedAt,
  };
  if (next.status === "done") {
    next.completedAt = task.status === "done" && task.completedAt !== null ? task.completedAt : now;
  } else {
    next.completedAt = null;
  }
  return next;
}

/** Board visibility of a task (BR-13): active tasks always show; completed tasks follow the person's preference. */
export function isTaskOnBoard(task: PersonalTask, visibility: CompletedVisibility, nowMs: number): boolean {
  if (task.status !== "done") return true;
  if (visibility === "hidden") return false;
  if (visibility === "all") return true;
  return task.completedAt !== null && nowMs - task.completedAt.getTime() < DONE_BOARD_WINDOW_MS;
}

/** Overdue (presentation rule): a due date before today, on a task that is not completed. Dates compare as strings. */
export function isOverdue(task: Pick<PersonalTask, "dueDate" | "status">, todayIso: string): boolean {
  return task.status !== "done" && task.dueDate !== null && task.dueDate < todayIso;
}

/** Deterministic column order: position, then id. */
export function compareTasks(a: Pick<PersonalTask, "position" | "id">, b: Pick<PersonalTask, "position" | "id">): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Completed-history order: newest completion first, id as tie-breaker. */
export function compareHistory(a: PersonalTask, b: PersonalTask): number {
  const at = a.completedAt?.getTime() ?? 0;
  const bt = b.completedAt?.getTime() ?? 0;
  if (at !== bt) return bt - at;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Keyset position of a history page: the last item shown. Opaque to the browser (encoded by the operation layer). */
export interface HistoryPosition {
  completedAtMs: number;
  id: string;
}

/** True when a completed task comes strictly after `position` in `compareHistory` order (newest first). */
export function isAfterHistoryPosition(task: PersonalTask, position: HistoryPosition): boolean {
  const at = task.completedAt?.getTime() ?? 0;
  if (at !== position.completedAtMs) return at < position.completedAtMs;
  return task.id < position.id;
}

/** The DTO returned to the browser: an explicit allow-list with ISO timestamps. No owner field. */
export interface TaskDto {
  id: string;
  title: string;
  description: string | null;
  notes: string | null;
  status: TaskStatus;
  priority: TaskPriority | null;
  dueDate: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export function toTaskDto(task: PersonalTask): TaskDto {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    notes: task.notes,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    position: task.position,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
  };
}

/**
 * Validates the decrypted content envelope of a stored task. Returns `null` when anything is off, so a malformed stored
 * task is refused, never repaired.
 */
export function parseStoredTaskContent(value: unknown): Omit<PersonalTask, "id" | "createdAt" | "updatedAt" | "completedAt"> | null {
  if (!isPlainObject(value)) return null;
  const allowed = ["title", "description", "notes", "status", "priority", "dueDate", "position"];
  if (!hasOnlyKeys(value, allowed)) return null;
  const title = normalizeTitle(value.title);
  const description = normalizeOptionalText(value.description, TASK_LIMITS.descriptionMax, "invalid_description");
  const notes = normalizeOptionalText(value.notes, TASK_LIMITS.notesMax, "invalid_notes");
  const priority = normalizePriority(value.priority);
  const dueDate = normalizeDueDate(value.dueDate);
  const status = normalizeStatus(value.status);
  if (!title.ok || !description.ok || !notes.ok || !priority.ok || !dueDate.ok || !status.ok) return null;
  if (typeof value.position !== "number" || !Number.isFinite(value.position)) return null;
  return {
    title: title.value,
    description: description.value,
    notes: notes.value,
    status: status.value,
    priority: priority.value,
    dueDate: dueDate.value,
    position: value.position,
  };
}

export function parseCompletedVisibilityBody(body: unknown): { ok: true; value: CompletedVisibility } | { ok: false; error: TaskValidationError } {
  if (!isPlainObject(body) || !hasOnlyKeys(body, ["completedVisibility"])) return { ok: false, error: "invalid_request" };
  return isCompletedVisibility(body.completedVisibility)
    ? { ok: true, value: body.completedVisibility }
    : { ok: false, error: "invalid_visibility" };
}

import { TASK_STATUSES, type TaskDto, type TaskStatus } from "./task";
import { placeTask } from "./task-ordering";

/**
 * Pure drop logic for the board (no React, no dnd-kit). The UI turns a drop into a `MoveTarget`; the server then places
 * the task with the same rule (`PATCH` with `status` and `beforeTaskId`). Columns are the visible board, sorted in the
 * order the server returns them, so the neighbours used here are the neighbours the user sees.
 */

export type BoardColumns = Readonly<Record<TaskStatus, readonly TaskDto[]>>;

/** Where a task goes: its column, and the visible task it is placed before (`null` = end of the column). */
export interface MoveTarget {
  status: TaskStatus;
  beforeTaskId: string | null;
}

const COLUMN_PREFIX = "column:";

/** Droppable id for an empty or whole-column drop target. Task ids never start with this prefix. */
export function columnDropId(status: TaskStatus): string {
  return `${COLUMN_PREFIX}${status}`;
}

export function parseColumnDropId(id: string): TaskStatus | null {
  if (!id.startsWith(COLUMN_PREFIX)) return null;
  const status = id.slice(COLUMN_PREFIX.length);
  return (TASK_STATUSES as readonly string[]).includes(status) ? (status as TaskStatus) : null;
}

function findTask(columns: BoardColumns, taskId: string): TaskDto | undefined {
  for (const status of TASK_STATUSES) {
    const task = columns[status].find((item) => item.id === taskId);
    if (task) return task;
  }
  return undefined;
}

/**
 * Resolves a drop of `taskId` onto `overId` (a task id or a column drop id). Returns `null` when nothing should be
 * written: an unknown task, dropping a task onto itself, or a drop that leaves the task where it already is.
 *
 * Same-column moves follow list semantics: moving down places the task after the target, moving up places it before.
 */
export function resolveDropMove(columns: BoardColumns, taskId: string, overId: string): MoveTarget | null {
  const source = findTask(columns, taskId);
  if (!source) return null;

  const columnStatus = parseColumnDropId(overId);
  let target: MoveTarget;
  if (columnStatus !== null) {
    target = { status: columnStatus, beforeTaskId: null };
  } else {
    const over = findTask(columns, overId);
    if (!over || over.id === taskId) return null;
    const column = columns[over.status];
    if (over.status === source.status) {
      const from = column.findIndex((item) => item.id === taskId);
      const to = column.findIndex((item) => item.id === overId);
      // Moving down lands after the target; moving up lands before it.
      const beforeTaskId = from < to ? (column[to + 1]?.id ?? null) : over.id;
      target = { status: over.status, beforeTaskId };
    } else {
      target = { status: over.status, beforeTaskId: over.id };
    }
  }

  if (target.status === source.status) {
    const current = columns[source.status];
    const index = current.findIndex((item) => item.id === taskId);
    const nextId = current[index + 1]?.id ?? null;
    // Already directly before the same neighbour (or already last): nothing to write.
    if (nextId === target.beforeTaskId) return null;
  }
  return target;
}

export interface PlacementPreview {
  id: string;
  status: TaskStatus;
  position: number;
}

/**
 * The optimistic positions for a move: the same placement the server computes, applied to the visible column. Any
 * neighbours renumbered by the placement are included, so the local order matches what the server will store.
 */
export function previewMove(columns: BoardColumns, taskId: string, target: MoveTarget): PlacementPreview[] | null {
  const source = findTask(columns, taskId);
  if (!source) return null;
  const column = columns[target.status].filter((item) => item.id !== taskId);
  const placed = placeTask(source, column, target.beforeTaskId);
  if (!placed.ok) return null;
  return placed.tasks.map((task) => ({
    id: task.id,
    status: task.id === taskId ? target.status : task.status,
    position: task.position,
  }));
}

"use client";

import { tasksCopy as copy } from "../copy";
import type { TaskDto } from "../domain/task";
import { formatDate } from "./format-date";

/**
 * The card shown under the pointer or keyboard cursor while dragging. Display only: no buttons, no select, no links. It
 * is rendered by the drag overlay, which is outside the column's focus order, so it must not offer controls.
 */
export function TaskCardPreview({ task, overdue }: { task: TaskDto; overdue: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="flex w-[min(18rem,80vw)] cursor-grabbing flex-col gap-2 rounded-lg border border-border-strong bg-surface p-3 shadow-lg"
    >
      <p className="break-words text-sm font-medium text-text-primary">{task.title}</p>
      {(task.priority !== null || task.dueDate !== null) && (
        <p className="flex flex-wrap gap-1.5 text-help text-text-secondary">
          {task.priority !== null && <span className="rounded border border-border-subtle px-1.5 py-0.5">{copy.priorityLabels[task.priority]}</span>}
          {task.dueDate !== null && (
            <span className={overdue ? "rounded border border-danger-text px-1.5 py-0.5 text-danger-text" : "rounded border border-border-subtle px-1.5 py-0.5"}>
              {copy.dueLabel(formatDate(task.dueDate))}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

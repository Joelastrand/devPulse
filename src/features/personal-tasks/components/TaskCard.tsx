"use client";

import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { CSSProperties, ReactNode, Ref } from "react";
import { tasksCopy as copy } from "../copy";
import type { TaskDto, TaskStatus } from "../domain/task";
import type { MoveTarget } from "../domain/task-move";
import { formatDate } from "./format-date";

interface TaskCardProps {
  task: TaskDto;
  overdue: boolean;
  /** A move, save or delete for this task is in flight. Shown as text, never by colour alone. */
  pending: boolean;
  onOpen: (task: TaskDto) => void;
  onMove: (task: TaskDto, target: MoveTarget) => void;
  /** The grip button, built by the sortable wrapper. Absent for the drag overlay copy, which is display-only. */
  grip?: ReactNode;
  dragging?: boolean;
  cardNode?: Ref<HTMLElement>;
  style?: CSSProperties;
}

/**
 * One compact task on the board. The title opens the editor. The grip is the only drag source (mouse, touch and
 * keyboard), so scrolling a column never starts a drag. The status select is the alternative to dragging.
 */
export function TaskCard({ task, overdue, pending, onOpen, onMove, grip, dragging = false, cardNode, style }: TaskCardProps) {
  const destinations = copy.statusOrder.filter((status) => status !== task.status);

  return (
    <article
      ref={cardNode}
      style={style}
      aria-busy={pending || undefined}
      data-dragging={dragging || undefined}
      className={`flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-3 shadow-sm transition-opacity ${
        dragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        {grip}
        <button
          type="button"
          onClick={() => onOpen(task)}
          className="min-w-0 flex-1 break-words rounded pt-1 text-left text-sm font-medium text-text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {task.title}
        </button>
      </div>

      <ul className="flex flex-wrap items-center gap-1.5 text-help text-text-secondary" aria-label="Egenskaper">
        {task.priority !== null && (
          <li className="rounded border border-border-subtle px-1.5 py-0.5">
            {copy.priorityLabels[task.priority]}
          </li>
        )}
        {task.dueDate !== null && (
          <li
            className={
              overdue
                ? "rounded border border-danger-text px-1.5 py-0.5 font-medium text-danger-text"
                : "rounded border border-border-subtle px-1.5 py-0.5"
            }
          >
            {overdue ? `${copy.dueDateOverdue}: ` : ""}
            {copy.dueLabel(formatDate(task.dueDate))}
          </li>
        )}
        {task.description !== null && <li className="px-1 py-0.5">{copy.hasDescription}</li>}
        {task.notes !== null && <li className="px-1 py-0.5">{copy.hasNotes}</li>}
      </ul>

      <div className="flex items-center gap-2">
        <label htmlFor={`move-${task.id}`} className="sr-only">
          {copy.moveSelectLabel(task.title)}
        </label>
        <select
          id={`move-${task.id}`}
          defaultValue=""
          disabled={pending}
          onChange={(event) => {
            const value = event.currentTarget.value;
            event.currentTarget.value = "";
            if (value !== "") onMove(task, { status: value as TaskStatus, beforeTaskId: null });
          }}
          className="min-h-9 w-full rounded border border-border-strong bg-surface px-2 text-help text-text-primary disabled:opacity-60"
        >
          <option value="">{pending ? copy.movePending : copy.moveChoose}</option>
          {destinations.map((status) => (
            <option key={status} value={status}>
              {copy.moveTo(copy.statusLabels[status])}
            </option>
          ))}
        </select>
      </div>
    </article>
  );
}

interface DragGripProps {
  title: string;
  enabled: boolean;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  gripNode: Ref<HTMLButtonElement>;
}

/**
 * The grip button. A disabled grip stays visible with a label that says why, and carries no drag listeners. The
 * touch-action rule keeps touch movement on the grip from scrolling the column; the card body is not a drag source.
 */
function DragGrip({ title, enabled, attributes, listeners, gripNode }: DragGripProps) {
  return (
    <button
      ref={gripNode}
      type="button"
      {...attributes}
      {...(enabled ? listeners : {})}
      disabled={!enabled}
      aria-label={enabled ? copy.dragHandleLabel(title) : copy.dragDisabledHandleLabel(title)}
      className="-ml-2 -mt-2 flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded text-text-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40 active:cursor-grabbing"
    >
      <GripVertical aria-hidden="true" className="size-4" />
    </button>
  );
}

/** Reads the reduced-motion preference on the client; the board is only rendered in the browser. */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface SortableTaskCardProps extends Omit<TaskCardProps, "grip" | "dragging" | "cardNode" | "style"> {
  dragEnabled: boolean;
}

/** A card inside a sortable column. Its identity is the stable task id, never its index. */
export function SortableTaskCard({ dragEnabled, ...props }: SortableTaskCardProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
    disabled: !dragEnabled,
  });
  const reduceMotion = prefersReducedMotion();
  return (
    <TaskCard
      {...props}
      cardNode={setNodeRef}
      dragging={isDragging}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: reduceMotion ? undefined : transition,
      }}
      grip={
        <DragGrip
          title={props.task.title}
          enabled={dragEnabled}
          attributes={attributes}
          listeners={listeners}
          gripNode={setActivatorNodeRef}
        />
      }
    />
  );
}

"use client";

import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlignLeft, EllipsisVertical, GripVertical, StickyNote } from "lucide-react";
import type { CSSProperties, ReactNode, Ref } from "react";
import { tasksCopy as copy } from "../copy";
import type { TaskDto } from "../domain/task";
import type { MoveTarget } from "../domain/task-move";
import { TaskDisclosure } from "./TaskDisclosure";
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
 * One compact task on the board: grip, title and an overflow menu on the first row, and metadata chips only when there
 * is something to show. The title opens the editor. The grip is the only drag source (mouse, touch and keyboard). The
 * overflow menu holds "Åpne" and the moves to the other statuses, so a move never depends on dragging.
 */
export function TaskCard({ task, overdue, pending, onOpen, onMove, grip, dragging = false, cardNode, style }: TaskCardProps) {
  const destinations = copy.statusOrder.filter((status) => status !== task.status);
  const hasMeta = task.priority !== null || task.dueDate !== null || task.notes !== null || task.description !== null || pending;

  return (
    <article
      ref={cardNode}
      style={style}
      aria-busy={pending || undefined}
      data-dragging={dragging || undefined}
      className={`flex flex-col gap-1 rounded-lg border border-border-subtle bg-surface p-2 shadow-sm transition-colors duration-micro hover:border-border-strong ${
        dragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-start gap-1">
        {grip}
        <button
          type="button"
          onClick={() => onOpen(task)}
          className="min-w-0 flex-1 break-words rounded py-2.5 text-left text-sm font-medium leading-snug text-text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {task.title}
        </button>
        <TaskDisclosure
          label={copy.moveMenuButton(task.title)}
          panelLabel={copy.moveMenuPanel(task.title)}
          triggerContent={<EllipsisVertical aria-hidden="true" className="size-4" />}
          panelClassName="flex flex-col gap-1 border-t border-border-subtle pt-2"
          className="shrink-0"
        >
          {(close) => (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => {
                  close(false);
                  onOpen(task);
                }}
                className="min-h-11 rounded px-2 text-left text-help text-text-primary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {copy.openTask}
              </button>
              {destinations.map((status) => (
                <button
                  key={status}
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    close(false);
                    onMove(task, { status, beforeTaskId: null });
                  }}
                  className="min-h-11 rounded px-2 text-left text-help text-text-primary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
                >
                  {copy.moveTo(copy.statusLabels[status])}
                </button>
              ))}
            </div>
          )}
        </TaskDisclosure>
      </div>

      {hasMeta && (
        <ul className="flex flex-wrap items-center gap-1.5 pl-9 text-help text-text-secondary">
          {task.priority !== null && (
            <li className="rounded border border-border-subtle px-1.5 py-0.5">{copy.priorityLabels[task.priority]}</li>
          )}
          {task.dueDate !== null && (
            <li
              className={
                overdue
                  ? "rounded bg-danger-subtle px-1.5 py-0.5 font-medium text-danger-text"
                  : "rounded border border-border-subtle px-1.5 py-0.5"
              }
            >
              {overdue ? `${copy.dueDateOverdue}: ` : ""}
              {copy.dueLabel(formatDate(task.dueDate))}
            </li>
          )}
          {task.description !== null && (
            <li className="flex items-center gap-1">
              <AlignLeft aria-hidden="true" className="size-3.5" />
              <span className="sr-only">{copy.hasDescription}</span>
            </li>
          )}
          {task.notes !== null && (
            <li className="flex items-center gap-1">
              <StickyNote aria-hidden="true" className="size-3.5" />
              <span className="sr-only">{copy.hasNotes}</span>
            </li>
          )}
          {pending && (
            <li className="text-text-secondary">
              {copy.movePending}
            </li>
          )}
        </ul>
      )}
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
      className="-ml-1 flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded text-text-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40 active:cursor-grabbing"
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

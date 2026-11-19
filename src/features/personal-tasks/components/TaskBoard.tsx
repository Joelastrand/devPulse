"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useMemo, useState } from "react";
import { tasksCopy as copy } from "../copy";
import type { TaskDto, TaskStatus } from "../domain/task";
import { parseColumnDropId, resolveDropMove, type BoardColumns, type MoveTarget } from "../domain/task-move";
import { TaskCardPreview } from "./TaskCardPreview";
import { TaskColumn, type CreateOutcome } from "./TaskColumn";

interface TaskBoardProps {
  /** Columns as shown (after search and filters). Equal to `allColumns` whenever drag is enabled. */
  columns: BoardColumns;
  /** The complete visible board, sorted. Drop targets are resolved against this, never against a filtered view. */
  allColumns: BoardColumns;
  overdueIds: ReadonlySet<string>;
  pendingById: ReadonlyMap<string, string>;
  dragEnabled: boolean;
  mobileStatus: TaskStatus;
  onOpen: (task: TaskDto) => void;
  onMove: (task: TaskDto, target: MoveTarget) => void;
  onCreate: (status: TaskStatus, title: string) => Promise<CreateOutcome>;
}

/** Points at the card under the pointer when there is one; otherwise falls back to the nearest corner. */
const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : closestCorners(args);
};

/**
 * The four-column board with drag-and-drop (dnd-kit). Each card has a grip handle with pointer, touch and keyboard
 * sensors. Drops are resolved by the pure `resolveDropMove`, then handed to the page, which persists them through the
 * authorised API. Nothing here writes; it only reports the intended move.
 */
export function TaskBoard({
  columns,
  allColumns,
  overdueIds,
  pendingById,
  dragEnabled,
  mobileStatus,
  onOpen,
  onMove,
  onCreate,
}: TaskBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // The column the dragged card would land in. Set from the collision target, so hovering a card highlights its column.
  const [overStatus, setOverStatus] = useState<TaskStatus | null>(null);

  const sensors = useSensors(
    // A small distance keeps a plain click on the grip from becoming a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const tasksById = useMemo(() => {
    const map = new Map<string, TaskDto>();
    for (const status of copy.statusOrder) for (const task of allColumns[status]) map.set(task.id, task);
    return map;
  }, [allColumns]);

  const activeTask = activeId === null ? undefined : tasksById.get(activeId);

  function titleOf(id: unknown): string {
    return typeof id === "string" ? (tasksById.get(id)?.title ?? "") : "";
  }

  /** The column a card would land in if dropped now, for the screen-reader announcement. */
  function statusOfOver(event: DragOverEvent): string | null {
    if (!event.over) return null;
    const target = resolveDropMove(allColumns, String(event.active.id), String(event.over.id));
    const status = target?.status ?? tasksById.get(String(event.over.id))?.status ?? null;
    return status === null ? null : copy.statusLabels[status];
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    const overId = event.over ? String(event.over.id) : null;
    if (overId === null) {
      setOverStatus(null);
      return;
    }
    setOverStatus(parseColumnDropId(overId) ?? tasksById.get(overId)?.status ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    setOverStatus(null);
    if (!event.over) return;
    const taskId = String(event.active.id);
    const task = tasksById.get(taskId);
    if (!task) return;
    const target = resolveDropMove(allColumns, taskId, String(event.over.id));
    if (target) onMove(task, target);
  }

  function handleDragCancel() {
    setActiveId(null);
    setOverStatus(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      accessibility={{
        screenReaderInstructions: { draggable: copy.dragInstructions },
        announcements: {
          onDragStart: ({ active }: DragStartEvent) => copy.dragAnnouncePickedUp(titleOf(active.id)),
          onDragOver: (event: DragOverEvent) => {
            const status = statusOfOver(event);
            return status === null ? undefined : copy.dragAnnounceOver(titleOf(event.active.id), status);
          },
          onDragEnd: ({ active, over }: DragEndEvent) => {
            if (!over) return copy.dragAnnounceCancelled;
            const target = resolveDropMove(allColumns, String(active.id), String(over.id));
            return target === null
              ? copy.dragAnnounceCancelled
              : copy.dragAnnounceDropped(titleOf(active.id), copy.statusLabels[target.status]);
          },
          onDragCancel: () => copy.dragAnnounceCancelled,
        },
      }}
    >
      <div className="grid gap-3 md:grid-cols-4">
        {copy.statusOrder.map((status) => (
          <TaskColumn
            key={status}
            status={status}
            active={mobileStatus === status}
            tasks={columns[status]}
            overdueIds={overdueIds}
            pendingById={pendingById}
            dragEnabled={dragEnabled}
            dropActive={overStatus === status}
            onOpen={onOpen}
            onMove={onMove}
            onCreate={onCreate}
          />
        ))}
      </div>

      <DragOverlay>{activeTask ? <TaskCardPreview task={activeTask} overdue={overdueIds.has(activeTask.id)} /> : null}</DragOverlay>
    </DndContext>
  );
}

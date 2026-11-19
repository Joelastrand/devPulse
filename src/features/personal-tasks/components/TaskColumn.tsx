"use client";

import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { tasksCopy as copy } from "../copy";
import type { TaskDto, TaskStatus } from "../domain/task";
import { columnDropId, type MoveTarget } from "../domain/task-move";
import { SortableTaskCard } from "./TaskCard";

export type CreateOutcome = { ok: true } | { ok: false; message: string };

interface TaskColumnProps {
  status: TaskStatus;
  tasks: readonly TaskDto[];
  overdueIds: ReadonlySet<string>;
  /** Pending action per task id ("move", "save", "delete", "reopen"), for the card's text state. */
  pendingById: ReadonlyMap<string, string>;
  /** Visible on narrow screens only when selected. Desktop always shows every column. */
  active: boolean;
  /** Drag reordering and cross-column drops are available (no filter active, no move pending). */
  dragEnabled: boolean;
  /** This column is where the dragged card would land (a column or one of its cards is under the pointer or cursor). */
  dropActive: boolean;
  onOpen: (task: TaskDto) => void;
  onMove: (task: TaskDto, target: MoveTarget) => void;
  onCreate: (status: TaskStatus, title: string) => Promise<CreateOutcome>;
}

/**
 * One board column: header with count, scrollable list, and inline creation. The whole column is a drop target, so an
 * empty column accepts a drop too. The header stays visible while the list scrolls. A failed create keeps the typed text.
 */
export function TaskColumn({
  status,
  tasks,
  overdueIds,
  pendingById,
  active,
  dragEnabled,
  dropActive,
  onOpen,
  onMove,
  onCreate,
}: TaskColumnProps) {
  const headingId = useId();
  const inputId = useId();
  // Registers the column as a drop target (for an empty column or the space below its cards). Highlighting uses `dropActive`.
  const { setNodeRef } = useDroppable({ id: columnDropId(status), disabled: !dragEnabled });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const inFlight = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const trimmed = title.trim();
    if (trimmed === "") {
      setError(copy.invalidTitle);
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(undefined);
    setNotice(undefined);
    const outcome = await onCreate(status, trimmed);
    inFlight.current = false;
    setPending(false);
    if (outcome.ok) {
      // Keep the form open so another task can be added straight away.
      setTitle("");
      setNotice(copy.createAnother);
    } else {
      setError(outcome.message);
    }
  }

  function cancel() {
    setAdding(false);
    setTitle("");
    setError(undefined);
    setNotice(undefined);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  }

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      data-status={status}
      data-drop-over={dropActive || undefined}
      className={`${active ? "flex" : "hidden"} min-w-0 flex-col rounded-xl bg-surface-subtle transition-shadow md:flex md:max-h-[calc(100vh-14rem)] ${
        dropActive ? "ring-2 ring-primary" : ""
      }`}
    >
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-t-xl bg-surface-subtle px-3 pb-2 pt-3">
        <h2 id={headingId} className="text-sm font-semibold text-text-primary">
          {copy.statusLabels[status]}
        </h2>
        <span className="text-help text-text-secondary">{copy.columnCount(tasks.length)}</span>
      </header>

      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-2">
          {tasks.length === 0 && !adding && (
            <p className="py-4 text-center text-help text-text-secondary">{dropActive ? copy.dragDropHere : copy.columnEmpty}</p>
          )}
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              overdue={overdueIds.has(task.id)}
              pending={pendingById.has(task.id)}
              dragEnabled={dragEnabled}
              onOpen={onOpen}
              onMove={onMove}
            />
          ))}
        </div>
      </SortableContext>

      <div className="px-3 pb-3 pt-2">
        {adding ? (
          <form onSubmit={submit} className="flex flex-col gap-2">
            <label id={`${inputId}-label`} htmlFor={inputId} className="sr-only">
              {copy.titleLabel}
            </label>
            <input
              id={inputId}
              autoFocus
              value={title}
              disabled={pending}
              placeholder={copy.titlePlaceholder}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${inputId}-hint`}
              onChange={(event) => setTitle(event.currentTarget.value)}
              onKeyDown={handleKeyDown}
              className="min-h-10 w-full rounded border border-border-strong bg-surface px-3 text-sm text-text-primary"
            />
            <p id={`${inputId}-hint`} className="text-help text-text-secondary">
              {copy.createHint}
            </p>
            {error && <Alert variant="error">{error}</Alert>}
            {notice && <Alert variant="success">{notice}</Alert>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" pending={pending}>
                {pending ? copy.createPending : copy.addButton}
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={cancel}>
                {copy.cancelButton}
              </Button>
            </div>
          </form>
        ) : (
          <Button
            type="button"
            variant="tertiary"
            size="sm"
            className="w-full justify-start"
            onClick={() => {
              setNotice(undefined);
              setAdding(true);
            }}
          >
            + {copy.addToColumn}
          </Button>
        )}
      </div>
    </section>
  );
}

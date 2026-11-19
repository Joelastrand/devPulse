"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Select } from "../../../components/ui/Select";
import { TextArea } from "../../../components/ui/TextArea";
import { TextField } from "../../../components/ui/TextField";
import { tasksCopy as copy } from "../copy";
import {
  TASK_LIMITS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type CreateTaskInput,
  type TaskDto,
  type TaskPriority,
  type TaskStatus,
  type UpdateTaskPatch,
} from "../domain/task";
import { formatTimestamp } from "./format-date";

const TABBABLE =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])";

/** The editable fields as the form holds them. Empty strings mean "not set" in the form only. */
interface Draft {
  title: string;
  description: string;
  notes: string;
  priority: TaskPriority | "";
  dueDate: string;
  status: TaskStatus;
}

export type TaskEditorResult = { ok: true } | { ok: false; message: string };

interface TaskEditorProps {
  /** `create` opens an empty form in `defaultStatus`; `edit` edits `task`. */
  mode: "create" | "edit";
  task?: TaskDto;
  defaultStatus: TaskStatus;
  onSave: (
    result:
      | { mode: "create"; input: CreateTaskInput }
      | { mode: "edit"; taskId: string; patch: UpdateTaskPatch },
  ) => Promise<TaskEditorResult>;
  onDelete?: (task: TaskDto) => Promise<TaskEditorResult>;
  onClose: () => void;
}

function draftFrom(task: TaskDto | undefined, defaultStatus: TaskStatus): Draft {
  return {
    title: task?.title ?? "",
    description: task?.description ?? "",
    notes: task?.notes ?? "",
    priority: task?.priority ?? "",
    dueDate: task?.dueDate ?? "",
    status: task?.status ?? defaultStatus,
  };
}

/** Only the fields that differ from the saved task are sent (a partial update). Empty optional text clears the field. */
function patchFor(task: TaskDto, draft: Draft): UpdateTaskPatch {
  const patch: UpdateTaskPatch = {};
  if (draft.title.trim() !== task.title) patch.title = draft.title.trim();
  if ((draft.description.trim() || null) !== task.description) patch.description = draft.description.trim() || null;
  if ((draft.notes.trim() || null) !== task.notes) patch.notes = draft.notes.trim() || null;
  if ((draft.priority || null) !== task.priority) patch.priority = draft.priority || null;
  if ((draft.dueDate || null) !== task.dueDate) patch.dueDate = draft.dueDate || null;
  if (draft.status !== task.status) patch.status = draft.status;
  return patch;
}

function isDirty(mode: "create" | "edit", task: TaskDto | undefined, draft: Draft, initial: Draft): boolean {
  if (mode === "edit" && task) return Object.keys(patchFor(task, draft)).length > 0;
  return JSON.stringify(draft) !== JSON.stringify(initial);
}

/**
 * Task detail editor, shown on the board without leaving it. A dialog panel (Escape closes, Tab is trapped, focus is
 * returned on close). Unsaved edits are never discarded silently: closing asks first. A failed save keeps the draft.
 */
export function TaskEditor({ mode, task, defaultStatus, onSave, onDelete, onClose }: TaskEditorProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // The saved snapshot the draft is compared with. Computed once, in state, so it never changes while the editor is open.
  const [initial] = useState<Draft>(() => draftFrom(task, defaultStatus));
  const [draft, setDraft] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const saveLock = useRef(false);

  const dirty = isDirty(mode, task, draft, initial);

  useEffect(() => {
    const returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("input")?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      returnFocusTo?.focus();
    };
  }, []);

  function requestClose() {
    if (saving || deleting) return;
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(TABBABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function save() {
    // The lock is set before any state update, so a second submit in the same tick is refused.
    if (saveLock.current) return;
    const title = draft.title.trim();
    if (title === "") {
      setError(copy.invalidTitle);
      return;
    }
    saveLock.current = true;
    setSaving(true);
    setError(undefined);
    const payload =
      mode === "create" || !task
        ? {
            mode: "create" as const,
            input: {
              title,
              description: draft.description.trim() || null,
              notes: draft.notes.trim() || null,
              priority: draft.priority || null,
              dueDate: draft.dueDate || null,
              status: draft.status,
            },
          }
        : { mode: "edit" as const, taskId: task.id, patch: patchFor(task, draft) };
    if (payload.mode === "edit" && Object.keys(payload.patch).length === 0) {
      saveLock.current = false;
      setSaving(false);
      onClose();
      return;
    }
    const result = await onSave(payload);
    saveLock.current = false;
    setSaving(false);
    if (result.ok) {
      onClose();
    } else {
      // The draft stays exactly as typed, so nothing the person wrote is lost.
      setError(result.message);
    }
  }

  async function remove() {
    if (!task || !onDelete || deleting) return;
    setDeleting(true);
    setError(undefined);
    const result = await onDelete(task);
    setDeleting(false);
    if (result.ok) onClose();
    else setError(result.message);
  }

  const busy = saving || deleting;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-text-primary/30 p-0 sm:items-center sm:p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        className="flex max-h-[92vh] w-full flex-col gap-4 overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-lg sm:max-w-xl sm:rounded-2xl"
      >
        <header className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-section-title font-semibold text-text-primary">
            {mode === "create" ? copy.editorTitleCreate : copy.editorTitleEdit}
          </h2>
          <Button type="button" variant="tertiary" size="sm" disabled={busy} onClick={requestClose}>
            {copy.editorClose}
          </Button>
        </header>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <TextField
            id={`${titleId}-title`}
            label={copy.titleLabel}
            value={draft.title}
            disabled={busy}
            onChange={(event) => setDraft({ ...draft, title: event.currentTarget.value })}
            aria-describedby={`${titleId}-title-hint`}
          />
          <p id={`${titleId}-title-hint`} className="-mt-3 text-help text-text-secondary">
            {`1–${TASK_LIMITS.titleMax} tegn.`}
          </p>

          <TextArea
            id={`${titleId}-description`}
            label={copy.descriptionLabel}
            optional
            value={draft.description}
            disabled={busy}
            onChange={(event) => setDraft({ ...draft, description: event.currentTarget.value })}
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <Select
              id={`${titleId}-status`}
              label="Status"
              value={draft.status}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, status: event.currentTarget.value as TaskStatus })}
            >
              {TASK_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {copy.statusLabels[status]}
                </option>
              ))}
            </Select>
            <Select
              id={`${titleId}-priority`}
              label={copy.priorityFieldLabel}
              optional
              description={copy.priorityDescription}
              value={draft.priority}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, priority: event.currentTarget.value as TaskPriority | "" })}
            >
              <option value="">{copy.priorityNone}</option>
              {TASK_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {copy.priorityLabels[priority]}
                </option>
              ))}
            </Select>
            <TextField
              id={`${titleId}-due`}
              label={copy.dueDateLabel}
              optional
              type="date"
              value={draft.dueDate}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, dueDate: event.currentTarget.value })}
            />
          </div>

          <TextArea
            id={`${titleId}-notes`}
            label={copy.notesLabel}
            optional
            description={copy.notesDescription}
            value={draft.notes}
            disabled={busy}
            onChange={(event) => setDraft({ ...draft, notes: event.currentTarget.value })}
          />

          {error && <Alert variant="error">{error}</Alert>}

          {confirmClose && (
            <div role="group" aria-label={copy.unsavedChanges} className="flex flex-col gap-2 rounded-lg border border-border-strong p-3">
              <p className="text-sm text-text-primary">{copy.unsavedChanges}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmClose(false)}>
                  {copy.keepEditing}
                </Button>
                <Button type="button" variant="destructive" size="sm" onClick={onClose}>
                  {copy.discardChanges}
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="md" pending={saving} disabled={busy}>
              {saving ? copy.savePending : copy.saveButton}
            </Button>
            <Button type="button" variant="secondary" size="md" disabled={busy} onClick={requestClose}>
              {copy.cancelButton}
            </Button>
          </div>
        </form>

        {mode === "edit" && task && (
          <footer className="flex flex-col gap-3 border-t border-border-subtle pt-4">
            <dl className="grid grid-cols-1 gap-1 text-help text-text-secondary sm:grid-cols-2">
              <div>
                <dt className="inline">{copy.createdLabel}: </dt>
                <dd className="inline">{formatTimestamp(task.createdAt)}</dd>
              </div>
              <div>
                <dt className="inline">{copy.updatedLabel}: </dt>
                <dd className="inline">{formatTimestamp(task.updatedAt)}</dd>
              </div>
              {task.completedAt && (
                <div>
                  <dt className="inline">{copy.completedLabel}: </dt>
                  <dd className="inline">{formatTimestamp(task.completedAt)}</dd>
                </div>
              )}
            </dl>

            {onDelete &&
              (confirmDelete ? (
                <div role="group" aria-label={copy.deleteConfirm(task.title)} className="flex flex-col gap-2">
                  <p className="text-sm font-medium text-text-primary">{copy.deleteConfirm(task.title)}</p>
                  <div className="flex gap-2">
                    <Button type="button" variant="destructive" size="sm" pending={deleting} onClick={() => void remove()}>
                      {deleting ? copy.deleteConfirmPending : copy.deleteConfirmButton}
                    </Button>
                    <Button type="button" variant="secondary" size="sm" disabled={deleting} onClick={() => setConfirmDelete(false)}>
                      {copy.cancelButton}
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => setConfirmDelete(true)}>
                    {copy.deleteButton}
                  </Button>
                </div>
              ))}
          </footer>
        )}
      </div>
    </div>
  );
}

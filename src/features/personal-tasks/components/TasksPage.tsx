"use client";

import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { LoadingRegion, Skeleton, SkeletonCard } from "../../../components/ui/Skeleton";
import { Select } from "../../../components/ui/Select";
import { TextField } from "../../../components/ui/TextField";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import {
  createTask,
  deleteTask,
  fetchTaskBoard,
  fetchTaskHistory,
  saveCompletedVisibility,
  updateTask,
  type TaskBoardData,
} from "../client/tasks-gateway";
import { tasksCopy as copy } from "../copy";
import {
  COMPLETED_VISIBILITIES,
  compareTasks,
  isOverdue,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type CompletedVisibility,
  type CreateTaskInput,
  type TaskDto,
  type TaskPriority,
  type TaskStatus,
  type UpdateTaskPatch,
} from "../domain/task";
import { previewMove, type BoardColumns, type MoveTarget } from "../domain/task-move";
import { formatTimestamp, todayIsoDate } from "./format-date";
import { TaskBoard } from "./TaskBoard";
import type { CreateOutcome } from "./TaskColumn";
import { TaskDisclosure } from "./TaskDisclosure";
import { TaskEditor, type TaskEditorResult } from "./TaskEditor";

type View = "board" | "history";
type Phase = "loading" | "signed_out" | "load_error" | "ready";
type EditorState = { mode: "create"; status: TaskStatus } | { mode: "edit"; task: TaskDto } | null;

/**
 * A move shown before the server confirms it. Cleared on success (after the authoritative board is reloaded) or at
 * once on failure, so a failed move rolls back to the server's order.
 */
interface OptimisticPlacement {
  status: TaskStatus;
  position: number;
  completedAt: string | null;
}

function applyPlacements(tasks: readonly TaskDto[], placements: ReadonlyMap<string, OptimisticPlacement>): TaskDto[] {
  if (placements.size === 0) return [...tasks];
  return tasks.map((task) => {
    const placement = placements.get(task.id);
    return placement ? { ...task, ...placement } : task;
  });
}

function groupByStatus(tasks: readonly TaskDto[]): BoardColumns {
  const columns: Record<TaskStatus, TaskDto[]> = { backlog: [], doing: [], blocked: [], done: [] };
  for (const task of tasks) columns[task.status].push(task);
  for (const status of TASK_STATUSES) columns[status].sort(compareTasks);
  return columns;
}

interface HistoryState {
  loaded: boolean;
  tasks: TaskDto[];
  nextCursor: string | null;
  loadingMore: boolean;
  error?: string;
}

const HISTORY_PAGE_SIZE = 25;
const EMPTY_HISTORY: HistoryState = { loaded: false, tasks: [], nextCursor: null, loadingMore: false };

/** Maps a server error code to the Norwegian message. Unknown and persistence failures never claim "not saved". */
function messageFor(error: string, fallback: string): string {
  switch (error) {
    case "invalid_title":
      return copy.invalidTitle;
    case "invalid_description":
      return copy.invalidDescription;
    case "invalid_notes":
      return copy.invalidNotes;
    case "invalid_due_date":
      return copy.invalidDueDate;
    case "not_found":
      return copy.notFound;
    case "task_limit":
      return copy.taskLimit;
    case "erasure_in_progress":
      return copy.erasureInProgress;
    case "invalid_request":
      return copy.invalidRequest;
    case "unknown":
    case "persistence_failed":
      return copy.outcomeUnknown;
    default:
      return fallback;
  }
}

function upsert(tasks: readonly TaskDto[], task: TaskDto): TaskDto[] {
  return tasks.some((item) => item.id === task.id)
    ? tasks.map((item) => (item.id === task.id ? task : item))
    : [...tasks, task];
}

/** The whole signed-in person's board. Every change is confirmed by the server before it is shown as done. */
export function TasksPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [board, setBoard] = useState<TaskBoardData | null>(null);
  const [view, setView] = useState<View>("board");
  const [history, setHistory] = useState<HistoryState>(EMPTY_HISTORY);
  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "">("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [mobileStatus, setMobileStatus] = useState<TaskStatus>("backlog");
  const [editor, setEditor] = useState<EditorState>(null);
  const [pending, setPending] = useState<ReadonlyMap<string, string>>(new Map());
  const [placements, setPlacements] = useState<ReadonlyMap<string, OptimisticPlacement>>(new Map());
  // Bumped on every account change: the board is remounted, so no drag from the previous account survives.
  const [sessionKey, setSessionKey] = useState(0);
  const [message, setMessage] = useState<{ kind: "status" | "error"; text: string }>();

  // The current auth context, so a late response can be checked against the generation it was started under.
  const authRef = useRef<{ token: string; generation: number } | null>(null);
  const boardRef = useRef<TaskBoardData | null>(null);
  // Synchronous duplicate guards: set before any state update, so a second submit in the same tick is refused.
  const locks = useRef(new Set<string>());

  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  const { isCurrentGeneration } = useAuthGatedResource((token, generation, isCurrent, change) => {
    if (change !== "refreshed") {
      // A different account (or sign-out): previous-account placements and pending state are dropped at once.
      setPlacements(new Map());
      setPending(new Map());
      setSessionKey((key) => key + 1);
    }
    if (token === null) {
      authRef.current = null;
      setBoard(null);
      setHistory(EMPTY_HISTORY);
      // An account change is "switched" before the new account arrives: stay loading, never show the old board.
      setPhase(change === "switched" ? "loading" : "signed_out");
      return;
    }
    authRef.current = { token, generation };
    if (change === "refreshed") {
      // Same account, new ID token: keep the board and any open editor draft, and refresh quietly.
      void loadBoard(token, generation, { silent: true });
      return;
    }
    setBoard(null);
    setHistory(EMPTY_HISTORY);
    setPhase("loading");
    void loadBoard(token, generation, { silent: false });
  });

  async function loadBoard(token: string, generation: number, options: { silent: boolean }) {
    const result = await fetchTaskBoard(token);
    if (!isCurrentGeneration(generation)) return;
    if (result.status === "unauthenticated") {
      setBoard(null);
      setPhase("signed_out");
      return;
    }
    if (result.status !== "ok") {
      if (boardRef.current !== null || options.silent) {
        setMessage({ kind: "error", text: copy.loadError });
      } else {
        setPhase("load_error");
      }
      return;
    }
    setBoard(result.board);
    setPhase("ready");
  }

  async function reloadAfterChange() {
    const auth = authRef.current;
    if (!auth) return;
    await loadBoard(auth.token, auth.generation, { silent: true });
    if (view === "history" || history.loaded) {
      await loadHistory(auth.token, auth.generation, { reset: true });
    }
  }

  async function loadHistory(token: string, generation: number, options: { reset: boolean }) {
    const cursor = options.reset ? null : history.nextCursor;
    setHistory((prev) => ({ ...prev, loadingMore: true, error: undefined }));
    const result = await fetchTaskHistory(token, { cursor, limit: HISTORY_PAGE_SIZE });
    if (!isCurrentGeneration(generation)) return;
    if (result.status !== "ok") {
      setHistory((prev) => ({ ...prev, loadingMore: false, error: copy.loadError }));
      return;
    }
    setHistory((prev) => ({
      loaded: true,
      loadingMore: false,
      nextCursor: result.page.nextCursor,
      tasks: options.reset ? result.page.tasks : [...prev.tasks, ...result.page.tasks.filter((task) => !prev.tasks.some((item) => item.id === task.id))],
    }));
  }

  function setPendingFor(taskId: string, action: string | null) {
    setPending((prev) => {
      const next = new Map(prev);
      if (action === null) next.delete(taskId);
      else next.set(taskId, action);
      return next;
    });
  }

  /** Runs one server mutation under a lock per key. Returns `null` when the key is already in flight. */
  async function guarded<T>(key: string, work: () => Promise<T>): Promise<T | null> {
    if (locks.current.has(key)) return null;
    locks.current.add(key);
    try {
      return await work();
    } finally {
      locks.current.delete(key);
    }
  }

  function currentAuth() {
    return authRef.current;
  }

  function clearPlacements(ids: readonly string[]) {
    setPlacements((prev) => {
      const next = new Map(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }

  /**
   * Moves one task to a column and position. The new order is shown at once and confirmed by the server. The server
   * decides the final position (transactional); the board is then reloaded so every neighbour shows the stored order.
   * Only one move runs at a time (drag is disabled while one is pending), and a second submit for the same task is refused.
   */
  async function moveTask(task: TaskDto, target: MoveTarget) {
    const preview = previewMove(allColumns, task.id, target);
    if (preview === null) return;
    const ids = preview.map((item) => item.id);
    const nowIso = new Date().toISOString();
    const entries = new Map<string, OptimisticPlacement>();
    for (const item of preview) {
      const current = board?.tasks.find((candidate) => candidate.id === item.id);
      entries.set(item.id, {
        status: item.status,
        position: item.position,
        completedAt: item.status === "done" ? (current?.completedAt ?? nowIso) : null,
      });
    }

    let started = false;
    const result = await guarded(`${task.id}:move`, async () => {
      const auth = currentAuth();
      if (!auth) return null;
      started = true;
      setPendingFor(task.id, "move");
      setPlacements((prev) => new Map([...prev, ...entries]));
      // `beforeTaskId` is sent only when there is a card to go in front of; absent means the end of the column.
      const patch = target.beforeTaskId === null ? { status: target.status } : { status: target.status, beforeTaskId: target.beforeTaskId };
      const outcome = await updateTask(auth.token, task.id, patch);
      if (!isCurrentGeneration(auth.generation)) return null;
      return outcome;
    });
    // A refused duplicate never started, so it must not clear the pending state of the move that is running.
    if (!started) return;
    setPendingFor(task.id, null);
    if (result === null) return; // Account changed meanwhile: the switch already dropped this placement.
    if (result.status === "unauthenticated") {
      clearPlacements(ids);
      setPhase("signed_out");
      return;
    }
    if (result.status === "error") {
      clearPlacements(ids);
      setMessage({ kind: "error", text: messageFor(result.error, copy.moveFailed) });
      void reloadAfterChange();
      return;
    }
    setBoard((prev) => (prev ? { ...prev, tasks: upsert(prev.tasks, result.task) } : prev));
    await reloadAfterChange();
    clearPlacements(ids);
    setMessage({ kind: "status", text: `Oppgaven er flyttet til ${copy.statusLabels[target.status]}.` });
  }

  async function createIn(status: TaskStatus, title: string): Promise<CreateOutcome> {
    const input: CreateTaskInput = {
      title,
      description: null,
      notes: null,
      priority: null,
      dueDate: null,
      status,
    };
    const result = await guarded("create", async () => {
      const auth = currentAuth();
      if (!auth) return null;
      const outcome = await createTask(auth.token, input);
      if (!isCurrentGeneration(auth.generation)) return null;
      return outcome;
    });
    if (result === null) return { ok: false, message: copy.createFailed };
    if (result.status === "unauthenticated") {
      setPhase("signed_out");
      return { ok: false, message: copy.createFailed };
    }
    if (result.status === "error") return { ok: false, message: messageFor(result.error, copy.createFailed) };
    setBoard((prev) => (prev ? { ...prev, tasks: upsert(prev.tasks, result.task) } : prev));
    void reloadAfterChange();
    return { ok: true };
  }

  async function saveEditor(
    request:
      | { mode: "create"; input: CreateTaskInput }
      | { mode: "edit"; taskId: string; patch: UpdateTaskPatch },
  ): Promise<TaskEditorResult> {
    const key = request.mode === "create" ? "create" : `${request.taskId}:save`;
    const result = await guarded(key, async () => {
      const auth = currentAuth();
      if (!auth) return null;
      const outcome =
        request.mode === "create"
          ? await createTask(auth.token, request.input)
          : await updateTask(auth.token, request.taskId, request.patch);
      if (!isCurrentGeneration(auth.generation)) return null;
      return outcome;
    });
    if (result === null) return { ok: false, message: copy.saveFailed };
    if (result.status === "unauthenticated") {
      setPhase("signed_out");
      return { ok: false, message: copy.saveFailed };
    }
    if (result.status === "error") {
      return { ok: false, message: messageFor(result.error, copy.saveFailed) };
    }
    setBoard((prev) => (prev ? { ...prev, tasks: upsert(prev.tasks, result.task) } : prev));
    setMessage({ kind: "status", text: request.mode === "create" ? "Oppgaven er lagt til." : "Endringene er lagret." });
    void reloadAfterChange();
    return { ok: true };
  }

  async function removeTask(task: TaskDto): Promise<TaskEditorResult> {
    const result = await guarded(`${task.id}:delete`, async () => {
      const auth = currentAuth();
      if (!auth) return null;
      setPendingFor(task.id, "delete");
      const outcome = await deleteTask(auth.token, task.id);
      if (!isCurrentGeneration(auth.generation)) return null;
      return outcome;
    });
    setPendingFor(task.id, null);
    if (result === null) return { ok: false, message: copy.deleteFailed };
    if (result.status === "unauthenticated") {
      setPhase("signed_out");
      return { ok: false, message: copy.deleteFailed };
    }
    if (result.status === "error") return { ok: false, message: copy.deleteFailed };
    setBoard((prev) => (prev ? { ...prev, tasks: prev.tasks.filter((item) => item.id !== task.id) } : prev));
    setHistory((prev) => ({ ...prev, tasks: prev.tasks.filter((item) => item.id !== task.id) }));
    setMessage({ kind: "status", text: "Oppgaven er slettet." });
    void reloadAfterChange();
    return { ok: true };
  }

  async function reopenTask(task: TaskDto) {
    const result = await guarded(`${task.id}:reopen`, async () => {
      const auth = currentAuth();
      if (!auth) return null;
      setPendingFor(task.id, "reopen");
      const outcome = await updateTask(auth.token, task.id, { status: "backlog" });
      if (!isCurrentGeneration(auth.generation)) return null;
      return outcome;
    });
    setPendingFor(task.id, null);
    if (result === null) return;
    if (result.status === "unauthenticated") {
      setPhase("signed_out");
      return;
    }
    if (result.status === "error") {
      setMessage({ kind: "error", text: messageFor(result.error, copy.reopenFailed) });
      return;
    }
    setHistory((prev) => ({ ...prev, tasks: prev.tasks.filter((item) => item.id !== task.id) }));
    setBoard((prev) => (prev ? { ...prev, tasks: upsert(prev.tasks, result.task) } : prev));
    setMessage({ kind: "status", text: "Oppgaven er gjenåpnet og ligger i Backlog." });
    void reloadAfterChange();
  }

  async function changeVisibility(value: CompletedVisibility) {
    const auth = currentAuth();
    if (!auth) return;
    const generation = auth.generation;
    const outcome = await saveCompletedVisibility(auth.token, value);
    if (!isCurrentGeneration(generation)) return;
    if (outcome.status === "unauthenticated") {
      setPhase("signed_out");
      return;
    }
    if (outcome.status === "error") {
      setMessage({ kind: "error", text: copy.outcomeUnknown });
      return;
    }
    await loadBoard(auth.token, generation, { silent: true });
  }

  const todayIso = todayIsoDate();
  // The board as the user sees it: server data with any move still awaiting confirmation laid over it.
  const displayTasks = useMemo(() => applyPlacements(board?.tasks ?? [], placements), [board, placements]);
  const allColumns = useMemo(() => groupByStatus(displayTasks), [displayTasks]);
  const overdueIds = useMemo(() => {
    const ids = new Set<string>();
    for (const task of displayTasks) if (isOverdue(task, todayIso)) ids.add(task.id);
    return ids;
  }, [displayTasks, todayIso]);

  const filtersActive = query.trim() !== "" || priorityFilter !== "" || overdueOnly;
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("nb-NO");
    return (task: TaskDto) => {
      if (priorityFilter !== "" && task.priority !== priorityFilter) return false;
      if (overdueOnly && !overdueIds.has(task.id)) return false;
      if (needle === "") return true;
      return (
        task.title.toLocaleLowerCase("nb-NO").includes(needle) ||
        (task.description ?? "").toLocaleLowerCase("nb-NO").includes(needle)
      );
    };
  }, [query, priorityFilter, overdueOnly, overdueIds]);

  const shownColumns = useMemo(() => groupByStatus(displayTasks.filter(matches)), [displayTasks, matches]);
  // Reordering is off while a search or filter hides tasks (their stored order cannot be preserved from the view) and
  // while another move is unconfirmed. The status select stays available in both cases.
  const dragEnabled = !filtersActive && pending.size === 0;

  function resetFilters() {
    setQuery("");
    setPriorityFilter("");
    setOverdueOnly(false);
  }

  if (phase === "loading") return <BoardSkeleton label={copy.loading} />;

  if (phase === "signed_out") {
    return (
      <p className="text-text-secondary">
        <Link href="/sign-in" className="font-medium text-text-primary underline">
          {copy.signInLink}
        </Link>{" "}
        {copy.signInPrompt}
      </p>
    );
  }

  if (phase === "load_error" || board === null) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="error">{copy.loadError}</Alert>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const auth = currentAuth();
            if (!auth) return;
            setPhase("loading");
            void loadBoard(auth.token, auth.generation, { silent: false });
          }}
        >
          {copy.retryButton}
        </Button>
      </div>
    );
  }

  const isEmptyBoard = displayTasks.length === 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Row 1: view switch and the primary action. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Visning" className="inline-flex gap-1 rounded-lg bg-surface-subtle p-1">
          <Button type="button" variant={view === "board" ? "primary" : "tertiary"} size="sm" aria-pressed={view === "board"} onClick={() => setView("board")}>
            {copy.boardTab}
          </Button>
          <Button
            type="button"
            variant={view === "history" ? "primary" : "tertiary"}
            size="sm"
            aria-pressed={view === "history"}
            onClick={() => {
              setView("history");
              const auth = currentAuth();
              if (auth && !history.loaded) void loadHistory(auth.token, auth.generation, { reset: true });
            }}
          >
            {copy.historyTab}
          </Button>
        </div>

        <Button type="button" size="sm" onClick={() => setEditor({ mode: "create", status: "backlog" })}>
          {copy.newTask}
        </Button>
      </div>

      {/* Row 2: search, filters and (board only) the board settings. Wraps on narrow screens. */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full min-w-0 sm:w-72">
          <TextField
            id="tasks-search"
            type="search"
            label={copy.searchLabel}
            placeholder={copy.searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>

        <div className="w-40">
          <Select id="tasks-priority" label={copy.priorityFilterLabel} value={priorityFilter} onChange={(event) => setPriorityFilter(event.currentTarget.value as TaskPriority | "")}>
            <option value="">{copy.priorityFilterAll}</option>
            {TASK_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {copy.priorityLabels[priority]}
              </option>
            ))}
          </Select>
        </div>

        <label className="flex min-h-10 items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={overdueOnly} onChange={(event) => setOverdueOnly(event.currentTarget.checked)} className="size-4" />
          {copy.overdueFilterLabel}
        </label>

        {filtersActive && (
          <Button type="button" variant="tertiary" size="sm" onClick={resetFilters}>
            {copy.clearSearch}
          </Button>
        )}

        {view === "board" && (
          <TaskDisclosure
            className="ml-auto w-full sm:w-auto"
            label={copy.boardSettingsButton}
            panelLabel={copy.boardSettingsPanel}
            triggerClassName="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-border-strong px-3 text-sm font-medium text-text-primary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-auto"
            panelClassName="mt-2 w-full rounded-lg border border-border-subtle bg-surface p-3 sm:w-72"
            triggerContent={
              <>
                <SlidersHorizontal aria-hidden="true" className="size-4" />
                {copy.boardSettingsButton}
              </>
            }
          >
            {() => (
              <Select
                id="tasks-visibility"
                label={copy.visibilityLabel}
                value={board.completedVisibility}
                onChange={(event) => void changeVisibility(event.currentTarget.value as CompletedVisibility)}
              >
                {COMPLETED_VISIBILITIES.map((value) => (
                  <option key={value} value={value}>
                    {copy.visibilityOptions[value]}
                  </option>
                ))}
              </Select>
            )}
          </TaskDisclosure>
        )}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {message?.kind === "status" ? message.text : ""}
      </p>
      {message?.kind === "error" && <Alert variant="error">{message.text}</Alert>}

      {view === "board" ? (
        <>
          {isEmptyBoard && (
            <div className="flex flex-col items-start gap-2 rounded-xl border border-border-subtle bg-surface p-5">
              <h2 className="text-section-title font-semibold text-text-primary">{copy.boardEmpty}</h2>
              <p className="text-text-secondary">{copy.boardEmptyBody}</p>
              <Button type="button" size="md" onClick={() => setEditor({ mode: "create", status: "backlog" })}>
                {copy.boardEmptyCta}
              </Button>
            </div>
          )}

          <nav aria-label="Kolonner" className="md:hidden">
            <div role="group" aria-label="Velg kolonne" className="grid grid-cols-4 gap-1">
              {TASK_STATUSES.map((status) => (
                <Button
                  key={status}
                  type="button"
                  variant={mobileStatus === status ? "primary" : "secondary"}
                  size="sm"
                  aria-pressed={mobileStatus === status}
                  onClick={() => setMobileStatus(status)}
                  className="min-h-11 justify-center px-2"
                >
                  {copy.statusLabels[status]}
                </Button>
              ))}
            </div>
            <p className="mt-1 text-help text-text-secondary">{copy.mobileColumnsHint}</p>
          </nav>

          {!dragEnabled && (
            <p className="text-help text-text-secondary" role="note">
              {filtersActive ? copy.dragDisabledByFilter : copy.dragDisabledByPending}
            </p>
          )}

          <TaskBoard
            key={sessionKey}
            columns={shownColumns}
            allColumns={allColumns}
            overdueIds={overdueIds}
            pendingById={pending}
            dragEnabled={dragEnabled}
            mobileStatus={mobileStatus}
            onOpen={(task) => setEditor({ mode: "edit", task })}
            onMove={moveTask}
            onCreate={createIn}
          />
        </>
      ) : (
        <HistoryList
          history={history}
          matches={matches}
          onOpen={(task) => setEditor({ mode: "edit", task })}
          onReopen={reopenTask}
          onMore={() => {
            const auth = currentAuth();
            if (auth) void loadHistory(auth.token, auth.generation, { reset: false });
          }}
          pending={pending}
        />
      )}

      {editor?.mode === "create" && (
        <TaskEditor
          mode="create"
          defaultStatus={editor.status}
          onSave={saveEditor}
          onClose={() => setEditor(null)}
        />
      )}
      {editor?.mode === "edit" && (
        <TaskEditor
          key={editor.task.id}
          mode="edit"
          task={editor.task}
          defaultStatus={editor.task.status}
          onSave={saveEditor}
          onDelete={removeTask}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}

function HistoryList({
  history,
  matches,
  onOpen,
  onReopen,
  onMore,
  pending,
}: {
  history: HistoryState;
  matches: (task: TaskDto) => boolean;
  onOpen: (task: TaskDto) => void;
  onReopen: (task: TaskDto) => void;
  onMore: () => void;
  pending: ReadonlyMap<string, string>;
}) {
  const visible = history.tasks.filter(matches);
  return (
    <section aria-labelledby="history-heading" className="flex flex-col gap-3">
      <h2 id="history-heading" className="text-section-title font-semibold text-text-primary">
        {copy.historyTitle}
      </h2>
      <p className="text-help text-text-secondary">{copy.historySearchNote}</p>
      {history.error && <Alert variant="error">{history.error}</Alert>}
      {history.loaded && history.tasks.length === 0 && <p className="text-text-secondary">{copy.historyEmpty}</p>}
      {history.loaded && history.tasks.length > 0 && visible.length === 0 && (
        <p className="text-text-secondary">{copy.noMatches}</p>
      )}
      <ul className="flex flex-col gap-2">
        {visible.map((task) => {
          const busy = pending.has(task.id);
          return (
            <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface p-3">
              <div className="flex min-w-0 flex-col gap-1">
                <button
                  type="button"
                  onClick={() => onOpen(task)}
                  className="break-words text-left text-sm font-medium text-text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {task.title}
                </button>
                <span className="text-help text-text-secondary">
                  {task.priority !== null ? `${copy.priorityLabels[task.priority]} · ` : ""}
                  {task.completedAt ? `${copy.completedLabel} ${formatTimestamp(task.completedAt)}` : ""}
                </span>
              </div>
              <Button type="button" variant="secondary" size="sm" pending={busy} disabled={busy} onClick={() => onReopen(task)}>
                {busy ? copy.reopenPending : copy.reopenButton}
              </Button>
            </li>
          );
        })}
      </ul>
      {history.nextCursor !== null && (
        <div>
          <Button type="button" variant="secondary" size="sm" disabled={history.loadingMore} pending={history.loadingMore} onClick={onMore}>
            {history.loadingMore ? copy.historyLoadingMore : copy.historyLoadMore}
          </Button>
        </div>
      )}
    </section>
  );
}

/** Layout-matched placeholder: four columns with a few cards each. No empty board is shown while loading. */
function BoardSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="grid gap-3 md:grid-cols-4">
      {[0, 1, 2, 3].map((column) => (
        <div key={column} className="flex flex-col gap-2 rounded-xl bg-surface-subtle p-3">
          <Skeleton className="h-5 w-24" />
          {[0, 1].map((card) => (
            <SkeletonCard key={card} className="flex flex-col gap-2 p-3">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-1/3" />
            </SkeletonCard>
          ))}
        </div>
      ))}
    </LoadingRegion>
  );
}


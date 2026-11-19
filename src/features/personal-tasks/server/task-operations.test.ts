import { describe, expect, it } from "vitest";
import { DONE_BOARD_WINDOW_MS, TASK_LIMITS } from "../domain/task";
import { POSITION_STEP } from "../domain/task-ordering";
import {
  clampHistoryLimit,
  createPersonalTask,
  decodeHistoryCursor,
  deletePersonalTask,
  listPersonalTaskBoard,
  listPersonalTaskHistory,
  setPersonalTaskPreferences,
  updatePersonalTask,
  type TaskOperationDeps,
} from "./task-operations";
import { createFakeTaskStore, type FakeTaskStore } from "./fake-task-store";

// Synthetic fixtures and a controlled clock. The owner uids are fictional.
const OWNER = "owner-uid-a";
const OTHER = "owner-uid-b";
const NOW = new Date("2026-11-18T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function setup(options: { now?: Date } = {}) {
  const store: FakeTaskStore = createFakeTaskStore();
  let counter = 0;
  let clock = options.now ?? NOW;
  const deps: TaskOperationDeps = {
    store,
    now: () => clock,
    newId: () => `task-${String(++counter).padStart(3, "0")}`,
  };
  return {
    store,
    deps,
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

async function create(deps: TaskOperationDeps, owner: string, body: Record<string, unknown>) {
  const result = await createPersonalTask(owner, body, deps);
  if (!result.ok) throw new Error(`create failed: ${result.error}`);
  return result.value;
}

describe("creating tasks", () => {
  it("creates a backlog task from a title alone, with the server-generated id and no optional fields", async () => {
    const { deps } = setup();
    const created = await create(deps, OWNER, { title: "Ny oppgave" });
    expect(created).toMatchObject({
      id: "task-001",
      title: "Ny oppgave",
      status: "backlog",
      priority: null,
      dueDate: null,
      completedAt: null,
      createdAt: NOW.toISOString(),
    });
  });

  it("creates directly in a chosen column and appends after the existing tasks of that column", async () => {
    const { deps } = setup();
    const first = await create(deps, OWNER, { title: "Første", status: "doing" });
    const second = await create(deps, OWNER, { title: "Andre", status: "doing" });
    expect(second.position).toBeGreaterThan(first.position);
  });

  it("refuses an empty title and stores nothing", async () => {
    const { deps, store } = setup();
    expect(await createPersonalTask(OWNER, { title: "   " }, deps)).toEqual({ ok: false, error: "invalid_title" });
    expect(store.stored(OWNER)).toHaveLength(0);
  });

  it("refuses creation at the task limit rather than dropping or truncating the board", async () => {
    const { deps, store } = setup();
    for (let i = 0; i < TASK_LIMITS.maxTasks; i += 1) {
      await create(deps, OWNER, { title: `Oppgave ${i}` });
    }
    expect(await createPersonalTask(OWNER, { title: "En til" }, deps)).toEqual({ ok: false, error: "task_limit" });
    expect(store.stored(OWNER)).toHaveLength(TASK_LIMITS.maxTasks);
  });

  it("maps a storage failure to persistence_failed without exposing details", async () => {
    const { deps, store } = setup();
    store.failNext();
    expect(await createPersonalTask(OWNER, { title: "x" }, deps)).toEqual({ ok: false, error: "persistence_failed" });
  });
});

describe("editing and moving tasks", () => {
  it("edits fields and leaves unspecified fields unchanged, updating updatedAt from the server clock", async () => {
    const { deps, advance } = setup();
    const created = await create(deps, OWNER, { title: "Titel", notes: "Synthetic note", priority: "high" });
    advance(DAY);
    const updated = await updatePersonalTask(OWNER, created.id, { title: "Ny titel" }, deps);
    expect(updated).toMatchObject({
      ok: true,
      value: { title: "Ny titel", notes: "Synthetic note", priority: "high", updatedAt: new Date(NOW.getTime() + DAY).toISOString() },
    });
  });

  it("clears an optional field when null is sent", async () => {
    const { deps } = setup();
    const created = await create(deps, OWNER, { title: "Titel", notes: "Notat", dueDate: "2026-11-20" });
    const updated = await updatePersonalTask(OWNER, created.id, { notes: null, dueDate: null }, deps);
    expect(updated).toMatchObject({ ok: true, value: { notes: null, dueDate: null } });
  });

  it("moves a task to another column at the end of it, and reports the new status", async () => {
    const { deps } = setup();
    const task = await create(deps, OWNER, { title: "Flytt meg" });
    const moved = await updatePersonalTask(OWNER, task.id, { status: "blocked" }, deps);
    expect(moved).toMatchObject({ ok: true, value: { status: "blocked", completedAt: null } });
  });

  it("places a task in front of a named task in the target column (reorder within a column)", async () => {
    const { deps, store } = setup();
    const a = await create(deps, OWNER, { title: "A" });
    const b = await create(deps, OWNER, { title: "B" });
    const c = await create(deps, OWNER, { title: "C" });
    // Move C in front of A: column order becomes C, A, B.
    const result = await updatePersonalTask(OWNER, c.id, { status: "backlog", beforeTaskId: a.id }, deps);
    expect(result.ok).toBe(true);
    expect(store.stored(OWNER).map((task) => task.id)).toEqual([c.id, a.id, b.id]);
  });

  it("drops a task into an empty column", async () => {
    const { deps, store } = setup();
    const task = await create(deps, OWNER, { title: "Alene" });
    const result = await updatePersonalTask(OWNER, task.id, { status: "done" }, deps);
    expect(result.ok).toBe(true);
    expect(store.stored(OWNER)[0]).toMatchObject({ status: "done" });
  });

  it("refuses a placement before a task that is not in the target column", async () => {
    const { deps, store } = setup();
    const a = await create(deps, OWNER, { title: "A", status: "doing" });
    const b = await create(deps, OWNER, { title: "B" });
    expect(await updatePersonalTask(OWNER, b.id, { status: "backlog", beforeTaskId: a.id }, deps)).toEqual({
      ok: false,
      error: "invalid_position",
    });
    expect(store.stored(OWNER).find((task) => task.id === b.id)?.status).toBe("backlog");
  });

  it("refuses to edit another person's task as not found, without leaking that it exists", async () => {
    const { deps } = setup();
    const task = await create(deps, OTHER, { title: "Privat" });
    expect(await updatePersonalTask(OWNER, task.id, { title: "Stjålet" }, deps)).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses a malformed task id before reading storage", async () => {
    const { deps } = setup();
    expect(await updatePersonalTask(OWNER, "../other", { title: "x" }, deps)).toEqual({ ok: false, error: "not_found" });
  });
});

describe("completion and reopening", () => {
  it("records completion from the server clock when a task enters done", async () => {
    const { deps, advance } = setup();
    const task = await create(deps, OWNER, { title: "Fullfør" });
    advance(3 * DAY);
    const done = await updatePersonalTask(OWNER, task.id, { status: "done" }, deps);
    expect(done).toMatchObject({ ok: true, value: { status: "done", completedAt: new Date(NOW.getTime() + 3 * DAY).toISOString() } });
  });

  it("reopens a completed task into the active board, clearing completedAt and not duplicating it", async () => {
    const { deps, store } = setup();
    const task = await create(deps, OWNER, { title: "Gjenåpne" });
    await updatePersonalTask(OWNER, task.id, { status: "done" }, deps);
    const reopened = await updatePersonalTask(OWNER, task.id, { status: "doing" }, deps);
    expect(reopened).toMatchObject({ ok: true, value: { status: "doing", completedAt: null } });
    expect(store.stored(OWNER)).toHaveLength(1);
  });
});

describe("deletion", () => {
  it("deletes an owned task", async () => {
    const { deps, store } = setup();
    const task = await create(deps, OWNER, { title: "Slett" });
    expect(await deletePersonalTask(OWNER, task.id, deps)).toEqual({ ok: true, value: null });
    expect(store.stored(OWNER)).toHaveLength(0);
  });

  it("is idempotent: deleting an absent task succeeds", async () => {
    const { deps } = setup();
    expect(await deletePersonalTask(OWNER, "task-404", deps)).toEqual({ ok: true, value: null });
  });

  it("never deletes another person's task", async () => {
    const { deps, store } = setup();
    const task = await create(deps, OTHER, { title: "Ikke din" });
    await deletePersonalTask(OWNER, task.id, deps);
    expect(store.stored(OTHER)).toHaveLength(1);
  });
});

describe("board visibility of completed tasks", () => {
  it("shows a task completed within seven days under the default preference, and hides it after seven days", async () => {
    const { deps, advance } = setup();
    const task = await create(deps, OWNER, { title: "Ferdig" });
    await updatePersonalTask(OWNER, task.id, { status: "done" }, deps);

    advance(DONE_BOARD_WINDOW_MS - DAY);
    let board = await listPersonalTaskBoard(OWNER, deps);
    expect(board.ok && board.value.tasks.map((t) => t.id)).toEqual([task.id]);

    advance(2 * DAY);
    board = await listPersonalTaskBoard(OWNER, deps);
    expect(board.ok && board.value.tasks).toEqual([]);
  });

  it("keeps a hidden completed task in history, and shows all completed tasks under 'all'", async () => {
    const { deps, advance } = setup();
    const task = await create(deps, OWNER, { title: "Gammel" });
    await updatePersonalTask(OWNER, task.id, { status: "done" }, deps);
    advance(30 * DAY);

    expect(await setPersonalTaskPreferences(OWNER, { completedVisibility: "hidden" }, deps)).toMatchObject({ ok: true });
    const hidden = await listPersonalTaskBoard(OWNER, deps);
    expect(hidden.ok && hidden.value.tasks).toEqual([]);
    const history = await listPersonalTaskHistory(OWNER, {}, deps);
    expect(history.ok && history.value.tasks.map((t) => t.id)).toEqual([task.id]);

    await setPersonalTaskPreferences(OWNER, { completedVisibility: "all" }, deps);
    const all = await listPersonalTaskBoard(OWNER, deps);
    expect(all.ok && all.value.tasks.map((t) => t.id)).toEqual([task.id]);
  });
});

describe("history", () => {
  it("lists completed tasks newest first and pages with an opaque cursor, never returning all of them at once", async () => {
    const { deps, advance } = setup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const task = await create(deps, OWNER, { title: `Fullført ${i}` });
      await updatePersonalTask(OWNER, task.id, { status: "done" }, deps);
      ids.push(task.id);
      advance(DAY);
    }
    const first = await listPersonalTaskHistory(OWNER, { limit: 2 }, deps);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.tasks.map((t) => t.id)).toEqual([ids[4], ids[3]]);
    expect(first.value.nextCursor).not.toBeNull();

    const second = await listPersonalTaskHistory(OWNER, { limit: 2, cursor: first.value.nextCursor }, deps);
    expect(second.ok && second.value.tasks.map((t) => t.id)).toEqual([ids[2], ids[1]]);
  });

  it("refuses a tampered or malformed cursor instead of guessing a position", async () => {
    const { deps } = setup();
    expect(await listPersonalTaskHistory(OWNER, { cursor: "not-a-cursor!" }, deps)).toEqual({ ok: false, error: "invalid_cursor" });
    expect(decodeHistoryCursor(Buffer.from('{"t":"x","id":"a"}').toString("base64url"))).toBeNull();
  });

  it("falls back to the default page size for an unusable limit and never to 'all'", () => {
    expect(clampHistoryLimit("abc")).toBe(TASK_LIMITS.historyPageDefault);
    expect(clampHistoryLimit(0)).toBe(TASK_LIMITS.historyPageDefault);
    expect(clampHistoryLimit(10_000)).toBe(TASK_LIMITS.historyPageMax);
  });
});

describe("preferences", () => {
  it("defaults to the last seven days, and persists a valid choice", async () => {
    const { deps, store } = setup();
    expect(await listPersonalTaskBoard(OWNER, deps)).toMatchObject({ ok: true, value: { completedVisibility: "last7" } });
    await setPersonalTaskPreferences(OWNER, { completedVisibility: "all" }, deps);
    expect(await store.getPreferences(OWNER)).toEqual({ completedVisibility: "all" });
  });

  it("refuses an unknown preference value and any extra key", async () => {
    const { deps } = setup();
    expect(await setPersonalTaskPreferences(OWNER, { completedVisibility: "forever" }, deps)).toEqual({
      ok: false,
      error: "invalid_visibility",
    });
    expect(await setPersonalTaskPreferences(OWNER, { completedVisibility: "all", owner: OTHER }, deps)).toEqual({
      ok: false,
      error: "invalid_request",
    });
  });
});

describe("account isolation", () => {
  it("never shows one owner's tasks on another owner's board", async () => {
    const { deps } = setup();
    await create(deps, OWNER, { title: "Kun for A" });
    const board = await listPersonalTaskBoard(OTHER, deps);
    expect(board.ok && board.value.tasks).toEqual([]);
  });

  it("does not include a stored owner field in the task response", async () => {
    const { deps } = setup();
    const task = await create(deps, OWNER, { title: "Synlig" });
    expect(Object.keys(task)).not.toContain("ownerUid");
    expect(Object.keys(task)).not.toContain("uid");
  });
});

describe("ordering is stable across reloads", () => {
  it("returns the same column order from a fresh read as the order that was written", async () => {
    const { deps } = setup();
    const a = await create(deps, OWNER, { title: "A" });
    const b = await create(deps, OWNER, { title: "B" });
    await updatePersonalTask(OWNER, b.id, { status: "backlog", beforeTaskId: a.id }, deps);
    const board = await listPersonalTaskBoard(OWNER, deps);
    expect(board.ok && board.value.tasks.map((t) => t.id)).toEqual([b.id, a.id]);
    expect(board.ok && board.value.tasks[0].position).toBeLessThan(POSITION_STEP);
  });
});

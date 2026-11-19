import { describe, expect, it } from "vitest";
import {
  applyTaskFields,
  DONE_BOARD_WINDOW_MS,
  isOverdue,
  isTaskOnBoard,
  isValidDueDate,
  parseCreateTaskBody,
  parseStoredTaskContent,
  parseUpdateTaskBody,
  TASK_LIMITS,
  toTaskDto,
  type PersonalTask,
} from "./task";

// Synthetic fixtures. Controlled clock: nothing here reads the real date.
const NOW = new Date("2026-11-18T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function task(overrides: Partial<PersonalTask> = {}): PersonalTask {
  return {
    id: "task-1",
    title: "Gjennomgå testplan",
    description: null,
    notes: null,
    status: "backlog",
    priority: null,
    dueDate: null,
    position: 1024,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...overrides,
  };
}

describe("create body validation", () => {
  it("accepts a title alone and defaults to backlog with no optional fields", () => {
    const result = parseCreateTaskBody({ title: "Ny oppgave" });
    expect(result).toEqual({
      ok: true,
      input: { title: "Ny oppgave", description: null, notes: null, priority: null, dueDate: null, status: "backlog" },
    });
  });

  it("trims the title and refuses an empty or whitespace-only title", () => {
    expect(parseCreateTaskBody({ title: "  Test  " })).toMatchObject({ ok: true, input: { title: "Test" } });
    expect(parseCreateTaskBody({ title: "   " })).toEqual({ ok: false, error: "invalid_title" });
    expect(parseCreateTaskBody({ title: "" })).toEqual({ ok: false, error: "invalid_title" });
  });

  it("refuses a title over the maximum length instead of truncating it", () => {
    const tooLong = "a".repeat(TASK_LIMITS.titleMax + 1);
    expect(parseCreateTaskBody({ title: tooLong })).toEqual({ ok: false, error: "invalid_title" });
    expect(parseCreateTaskBody({ title: "a".repeat(TASK_LIMITS.titleMax) })).toMatchObject({ ok: true });
  });

  it("refuses descriptions and notes over their limits", () => {
    expect(parseCreateTaskBody({ title: "x", description: "d".repeat(TASK_LIMITS.descriptionMax + 1) })).toEqual({
      ok: false,
      error: "invalid_description",
    });
    expect(parseCreateTaskBody({ title: "x", notes: "n".repeat(TASK_LIMITS.notesMax + 1) })).toEqual({
      ok: false,
      error: "invalid_notes",
    });
  });

  it("refuses an unknown status and an unknown priority", () => {
    expect(parseCreateTaskBody({ title: "x", status: "archived" })).toEqual({ ok: false, error: "invalid_status" });
    expect(parseCreateTaskBody({ title: "x", priority: "urgent" })).toEqual({ ok: false, error: "invalid_priority" });
  });

  it("refuses impossible calendar dates and accepts a real one", () => {
    expect(parseCreateTaskBody({ title: "x", dueDate: "2026-02-30" })).toEqual({ ok: false, error: "invalid_due_date" });
    expect(parseCreateTaskBody({ title: "x", dueDate: "2026-11-18T10:00" })).toEqual({ ok: false, error: "invalid_due_date" });
    expect(parseCreateTaskBody({ title: "x", dueDate: "2026-11-18" })).toMatchObject({ ok: true, input: { dueDate: "2026-11-18" } });
  });

  it("refuses unknown keys, so an owner or id cannot be supplied by the client", () => {
    expect(parseCreateTaskBody({ title: "x", ownerUid: "someone-else" })).toEqual({ ok: false, error: "invalid_request" });
    expect(parseCreateTaskBody({ title: "x", id: "forced-id" })).toEqual({ ok: false, error: "invalid_request" });
    expect(parseCreateTaskBody(null)).toEqual({ ok: false, error: "invalid_request" });
  });
});

describe("update body validation", () => {
  it("refuses an empty patch and placement without a status", () => {
    expect(parseUpdateTaskBody({})).toEqual({ ok: false, error: "invalid_request" });
    expect(parseUpdateTaskBody({ beforeTaskId: "task-2" })).toEqual({ ok: false, error: "invalid_request" });
  });

  it("treats null as clearing an optional field and omits absent fields", () => {
    expect(parseUpdateTaskBody({ notes: null, priority: null })).toEqual({
      ok: true,
      patch: { notes: null, priority: null },
    });
  });

  it("refuses a malformed placement id", () => {
    expect(parseUpdateTaskBody({ status: "doing", beforeTaskId: "../etc" })).toEqual({ ok: false, error: "invalid_position" });
  });
});

describe("completion invariant", () => {
  it("sets completedAt from the server clock when a task enters done", () => {
    const done = applyTaskFields(task(), { status: "done" }, NOW);
    expect(done.status).toBe("done");
    expect(done.completedAt).toEqual(NOW);
  });

  it("keeps the original completion time when a done task is edited without leaving done", () => {
    const completedAt = new Date(NOW.getTime() - 2 * DAY);
    const current = task({ status: "done", completedAt });
    const edited = applyTaskFields(current, { title: "Nytt navn" }, NOW);
    expect(edited.completedAt).toEqual(completedAt);
  });

  it("clears completedAt when a completed task is reopened, so it returns to the active board", () => {
    const current = task({ status: "done", completedAt: NOW });
    const reopened = applyTaskFields(current, { status: "doing" }, NOW);
    expect(reopened.status).toBe("doing");
    expect(reopened.completedAt).toBeNull();
  });
});

describe("board and history visibility", () => {
  it("always shows active tasks, whatever the completed-task preference", () => {
    for (const visibility of ["last7", "all", "hidden"] as const) {
      expect(isTaskOnBoard(task({ status: "blocked" }), visibility, NOW.getTime())).toBe(true);
    }
  });

  it("shows a task completed within seven days under the default preference", () => {
    const completedAt = new Date(NOW.getTime() - (DONE_BOARD_WINDOW_MS - DAY));
    expect(isTaskOnBoard(task({ status: "done", completedAt }), "last7", NOW.getTime())).toBe(true);
  });

  it("hides a task completed more than seven days ago under the default preference", () => {
    const completedAt = new Date(NOW.getTime() - (DONE_BOARD_WINDOW_MS + DAY));
    expect(isTaskOnBoard(task({ status: "done", completedAt }), "last7", NOW.getTime())).toBe(false);
  });

  it("shows every completed task under 'all' and none under 'hidden'", () => {
    const completedAt = new Date(NOW.getTime() - 30 * DAY);
    const old = task({ status: "done", completedAt });
    expect(isTaskOnBoard(old, "all", NOW.getTime())).toBe(true);
    expect(isTaskOnBoard(old, "hidden", NOW.getTime())).toBe(false);
  });

  it("a hidden completed task keeps its completedAt, so it stays in history", () => {
    const completedAt = new Date(NOW.getTime() - 30 * DAY);
    const old = task({ status: "done", completedAt });
    expect(isTaskOnBoard(old, "last7", NOW.getTime())).toBe(false);
    expect(old.completedAt).toEqual(completedAt);
  });
});

describe("due dates and overdue", () => {
  it("compares calendar dates as strings, so a task due today is not overdue", () => {
    expect(isOverdue({ dueDate: "2026-11-18", status: "doing" }, "2026-11-18")).toBe(false);
    expect(isOverdue({ dueDate: "2026-11-17", status: "doing" }, "2026-11-18")).toBe(true);
  });

  it("never marks a completed task overdue", () => {
    expect(isOverdue({ dueDate: "2026-11-01", status: "done" }, "2026-11-18")).toBe(false);
  });

  it("accepts only real calendar dates", () => {
    expect(isValidDueDate("2024-02-29")).toBe(true);
    expect(isValidDueDate("2025-02-29")).toBe(false);
    expect(isValidDueDate(20261118)).toBe(false);
  });
});

describe("stored content validation", () => {
  it("accepts exactly the shape the writer produces", () => {
    expect(
      parseStoredTaskContent({
        title: "Gjennomgå testplan",
        description: null,
        notes: "Synthetic note",
        status: "blocked",
        priority: "high",
        dueDate: "2026-11-20",
        position: 2048,
      }),
    ).toMatchObject({ title: "Gjennomgå testplan", status: "blocked", position: 2048 });
  });

  it("refuses unknown keys and a non-finite position", () => {
    const base = { title: "x", description: null, notes: null, status: "backlog", priority: null, dueDate: null, position: 0 };
    expect(parseStoredTaskContent({ ...base, extra: true })).toBeNull();
    expect(parseStoredTaskContent({ ...base, position: Number.NaN })).toBeNull();
  });
});

describe("DTO allow-list", () => {
  it("exposes only the task fields, with ISO timestamps and no owner", () => {
    const dto = toTaskDto(task({ status: "done", completedAt: NOW }));
    expect(Object.keys(dto).sort()).toEqual(
      ["completedAt", "createdAt", "description", "dueDate", "id", "notes", "position", "priority", "status", "title", "updatedAt"].sort(),
    );
    expect(dto.completedAt).toBe(NOW.toISOString());
  });
});

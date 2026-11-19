import { describe, expect, it } from "vitest";
import type { TaskDto, TaskStatus } from "./task";
import { columnDropId, parseColumnDropId, previewMove, resolveDropMove, type BoardColumns } from "./task-move";
import { POSITION_STEP } from "./task-ordering";

// Synthetic, fictional tasks. Only the fields the move logic reads matter.
function dto(id: string, status: TaskStatus, position: number): TaskDto {
  return {
    id,
    title: `Oppgave ${id}`,
    description: null,
    notes: null,
    status,
    priority: null,
    dueDate: null,
    position,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    completedAt: status === "done" ? "2026-11-10T10:00:00.000Z" : null,
  };
}

function board(parts: Partial<Record<TaskStatus, string[]>>): BoardColumns {
  const columns: Record<TaskStatus, TaskDto[]> = { backlog: [], doing: [], blocked: [], done: [] };
  for (const status of Object.keys(parts) as TaskStatus[]) {
    (parts[status] ?? []).forEach((id, index) => {
      columns[status].push(dto(id, status, (index + 1) * POSITION_STEP));
    });
  }
  return columns;
}

describe("column drop ids", () => {
  it("round-trips every status and rejects task ids and unknown values", () => {
    for (const status of ["backlog", "doing", "blocked", "done"] as const) {
      expect(parseColumnDropId(columnDropId(status))).toBe(status);
    }
    expect(parseColumnDropId("a-task-id")).toBeNull();
    expect(parseColumnDropId("column:archived")).toBeNull();
  });
});

describe("resolveDropMove", () => {
  it("moves a task from Backlog to Pågår, before the target card", () => {
    const columns = board({ backlog: ["a", "b"], doing: ["c", "d"] });
    expect(resolveDropMove(columns, "a", "d")).toEqual({ status: "doing", beforeTaskId: "d" });
  });

  it("moves across each adjacent pair of statuses and out of Fullført", () => {
    const columns = board({ doing: ["a"], blocked: ["b"], done: ["c"] });
    expect(resolveDropMove(columns, "a", columnDropId("blocked"))).toEqual({ status: "blocked", beforeTaskId: null });
    expect(resolveDropMove(columns, "b", columnDropId("done"))).toEqual({ status: "done", beforeTaskId: null });
    expect(resolveDropMove(columns, "c", columnDropId("backlog"))).toEqual({ status: "backlog", beforeTaskId: null });
  });

  it("drops into an empty column at the end", () => {
    const columns = board({ backlog: ["a"] });
    expect(resolveDropMove(columns, "a", columnDropId("blocked"))).toEqual({ status: "blocked", beforeTaskId: null });
  });

  it("reorders within a column: moving down lands after the target", () => {
    const columns = board({ backlog: ["a", "b", "c", "d"] });
    // a is above c: drop on c places a after c, i.e. before d.
    expect(resolveDropMove(columns, "a", "c")).toEqual({ status: "backlog", beforeTaskId: "d" });
  });

  it("reorders within a column: moving up lands before the target", () => {
    const columns = board({ backlog: ["a", "b", "c", "d"] });
    expect(resolveDropMove(columns, "d", "b")).toEqual({ status: "backlog", beforeTaskId: "b" });
  });

  it("moves to the first position", () => {
    const columns = board({ backlog: ["a", "b", "c"] });
    expect(resolveDropMove(columns, "c", "a")).toEqual({ status: "backlog", beforeTaskId: "a" });
  });

  it("moves to the last position", () => {
    const columns = board({ backlog: ["a", "b", "c"] });
    expect(resolveDropMove(columns, "a", "c")).toEqual({ status: "backlog", beforeTaskId: null });
  });

  it("returns null (no write) when the task already sits in that place", () => {
    const columns = board({ backlog: ["a", "b", "c"] });
    expect(resolveDropMove(columns, "a", "a")).toBeNull(); // dropped on itself
    expect(resolveDropMove(columns, "b", "a")).toEqual({ status: "backlog", beforeTaskId: "a" }); // b moves up before a
    expect(resolveDropMove(columns, "c", columnDropId("backlog"))).toBeNull(); // already last
    expect(resolveDropMove(columns, "a", "b")).toEqual({ status: "backlog", beforeTaskId: "c" }); // a moves after b
  });

  it("returns null for an unknown task or an unknown drop target", () => {
    const columns = board({ backlog: ["a"] });
    expect(resolveDropMove(columns, "missing", "a")).toBeNull();
    expect(resolveDropMove(columns, "a", "not-a-task")).toBeNull();
  });

  it("handles many tasks: the first, middle and last positions resolve to the same neighbours", () => {
    const ids = Array.from({ length: 100 }, (_, i) => `t${String(i).padStart(3, "0")}`);
    const columns = board({ backlog: ids });
    expect(resolveDropMove(columns, ids[50], ids[10])).toEqual({ status: "backlog", beforeTaskId: ids[10] });
    expect(resolveDropMove(columns, ids[0], ids[99])).toEqual({ status: "backlog", beforeTaskId: null });
  });
});

describe("previewMove", () => {
  it("places the moved task at the same position the server would compute", () => {
    const columns = board({ backlog: ["a", "b"], doing: ["c", "d"] });
    const preview = previewMove(columns, "a", { status: "doing", beforeTaskId: "d" });
    expect(preview).not.toBeNull();
    const moved = preview?.find((item) => item.id === "a");
    expect(moved).toEqual({ id: "a", status: "doing", position: expect.any(Number) });
    // c is at one step, d at two steps: a lands strictly between them.
    expect(moved?.position).toBeGreaterThan(POSITION_STEP);
    expect(moved?.position).toBeLessThan(2 * POSITION_STEP);
  });

  it("appends to the end of a column with the next step", () => {
    const columns = board({ backlog: ["a"], doing: ["c", "d"] });
    const preview = previewMove(columns, "a", { status: "doing", beforeTaskId: null });
    expect(preview?.find((item) => item.id === "a")).toEqual({ id: "a", status: "doing", position: 3 * POSITION_STEP });
  });

  it("returns null when the moved task is not on the board", () => {
    expect(previewMove(board({ doing: ["c"] }), "x", { status: "doing", beforeTaskId: null })).toBeNull();
  });

  it("returns the renumbered neighbours when the midpoint is not strictly between them", () => {
    const columns: BoardColumns = {
      backlog: [dto("a", "backlog", 0)],
      doing: [dto("c", "doing", 1), dto("d", "doing", 1 + Number.EPSILON * 4)],
      blocked: [],
      done: [],
    };
    const preview = previewMove(columns, "a", { status: "doing", beforeTaskId: "d" });
    expect(preview).not.toBeNull();
    const positions = preview?.map((item) => item.position) ?? [];
    expect(positions).toEqual([...positions].sort((x, y) => x - y));
    expect(new Set(positions).size).toBe(positions.length);
  });
});

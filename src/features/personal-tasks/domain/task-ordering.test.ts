import { describe, expect, it } from "vitest";
import { placeTask, POSITION_STEP } from "./task-ordering";
import type { PersonalTask } from "./task";

const NOW = new Date("2026-11-18T12:00:00.000Z");

function task(id: string, position: number): PersonalTask {
  return {
    id,
    title: `Oppgave ${id}`,
    description: null,
    notes: null,
    status: "backlog",
    priority: null,
    dueDate: null,
    position,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
  };
}

describe("placeTask", () => {
  it("places a task at the first step in an empty column", () => {
    const result = placeTask(task("a", 0), [], null);
    expect(result).toEqual({ ok: true, tasks: [expect.objectContaining({ id: "a", position: 0 })] });
  });

  it("appends after the last task when no anchor is given", () => {
    const column = [task("a", 0), task("b", POSITION_STEP)];
    const result = placeTask(task("c", 0), column, null);
    expect(result.ok && result.tasks[0].position).toBe(2 * POSITION_STEP);
  });

  it("places a task before an anchor at the midpoint of its neighbours, touching only the moved task", () => {
    const column = [task("a", 0), task("b", 1000)];
    const result = placeTask(task("c", 0), column, "b");
    expect(result).toEqual({ ok: true, tasks: [expect.objectContaining({ id: "c", position: 500 })] });
  });

  it("places before the first task with a position below it", () => {
    const column = [task("a", 1000)];
    const result = placeTask(task("c", 0), column, "a");
    expect(result.ok && result.tasks[0].position).toBe(1000 - POSITION_STEP);
  });

  it("refuses an anchor that is not in the target column", () => {
    expect(placeTask(task("c", 0), [task("a", 0)], "missing")).toEqual({ ok: false, error: "invalid_position" });
  });

  it("renumbers the column when two neighbours are too close for a strictly-between value", () => {
    // 1 and 1 + EPSILON have no representable value strictly between them, so the midpoint would collide.
    const column = [task("a", 1), task("b", 1 + Number.EPSILON)];
    const result = placeTask(task("c", 0), column, "b");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tasks.map((t) => t.id)).toEqual(["a", "c", "b"]);
    expect(result.tasks.map((t) => t.position)).toEqual([0, POSITION_STEP, 2 * POSITION_STEP]);
  });

  it("orders ties deterministically by id", () => {
    const column = [task("b", 5), task("a", 5)];
    const result = placeTask(task("c", 0), column, null);
    expect(result.ok && result.tasks[0].position).toBe(5 + POSITION_STEP);
  });
});

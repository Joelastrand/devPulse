import { describe, expect, it } from "vitest";
import type { OwnerSummaryWire } from "../../development-conversations/client/conversations-gateway";
import type { TaskDto } from "../../personal-tasks/domain/task";
import { addDays, buildAttentionItems, countOpenTasks, DUE_SOON_DAYS } from "./attention-items";

const TODAY = "2026-05-10";

const conversation = (conversationId: string, status: "open" | "completed", plannedFor: string | null): OwnerSummaryWire => ({
  conversationId,
  title: `Samtale ${conversationId}`,
  status,
  plannedFor,
  participant: { state: "accepted", displayName: "Kari Nordmann" },
  sharedGoalCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as OwnerSummaryWire);

const task = (
  id: string,
  status: TaskDto["status"],
  dueDate: string | null,
  priority: TaskDto["priority"] = null,
): TaskDto => ({
  id,
  title: `Oppgave ${id}`,
  description: null,
  notes: null,
  status,
  priority,
  dueDate,
  position: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  completedAt: status === "done" ? "2026-05-01T00:00:00.000Z" : null,
});

describe("addDays", () => {
  it("adds calendar days across a month boundary", () => {
    expect(addDays("2026-01-30", 3)).toBe("2026-02-02");
  });
});

describe("buildAttentionItems", () => {
  it("selects the earliest open conversation and ignores completed ones", () => {
    const items = buildAttentionItems({
      conversations: [conversation("late", "open", "2026-09-01"), conversation("done", "completed", "2026-05-01"), conversation("early", "open", "2026-06-01")],
      tasks: [],
      todayIso: TODAY,
    });
    expect(items).toEqual([
      { kind: "conversation", conversationId: "early", title: "Samtale early", plannedFor: "2026-06-01", participantName: "Kari Nordmann" },
    ]);
  });

  it("marks past due dates as overdue and near dates as due soon, sorted by date", () => {
    const items = buildAttentionItems({
      conversations: [],
      tasks: [
        task("soon", "backlog", addDays(TODAY, 2)),
        task("over", "doing", "2026-05-01"),
      ],
      todayIso: TODAY,
    });
    expect(items).toEqual([
      { kind: "task", taskId: "over", title: "Oppgave over", dueDate: "2026-05-01", state: "overdue" },
      { kind: "task", taskId: "soon", title: "Oppgave soon", dueDate: addDays(TODAY, 2), state: "due_soon" },
    ]);
  });

  it("excludes done tasks and tasks due beyond the horizon", () => {
    const items = buildAttentionItems({
      conversations: [],
      tasks: [task("done", "done", "2026-05-01"), task("far", "backlog", addDays(TODAY, DUE_SOON_DAYS + 1))],
      todayIso: TODAY,
    });
    expect(items).toEqual([]);
  });

  it("includes an undated high-priority task as a high-priority item, not as overdue", () => {
    const items = buildAttentionItems({
      conversations: [],
      tasks: [task("hi", "backlog", null, "high"), task("normal", "backlog", null, "normal")],
      todayIso: TODAY,
    });
    expect(items).toEqual([{ kind: "task", taskId: "hi", title: "Oppgave hi", dueDate: null, state: "high_priority" }]);
  });

  it("limits the result to three items with the conversation first", () => {
    const items = buildAttentionItems({
      conversations: [conversation("c", "open", "2026-06-01")],
      tasks: [task("a", "doing", "2026-05-01"), task("b", "doing", "2026-05-02"), task("c", "doing", "2026-05-03")],
      todayIso: TODAY,
    });
    expect(items).toHaveLength(3);
    expect(items[0]?.kind).toBe("conversation");
  });
});

describe("countOpenTasks", () => {
  it("counts every task that is not done", () => {
    expect(countOpenTasks([task("a", "backlog", null), task("b", "blocked", null), task("c", "done", null)])).toBe(2);
  });
});

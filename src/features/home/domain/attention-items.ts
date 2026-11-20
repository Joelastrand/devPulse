import type { OwnerSummaryWire } from "../../development-conversations/client/conversations-gateway";
import type { TaskDto } from "../../personal-tasks/domain/task";

/**
 * Presentation-level selection for "Dette er viktig nå". It only re-orders and
 * limits data the home already holds: no score, no new endpoint, and no urgency
 * that the data does not state. A task is shown only when its due date is past
 * or within the horizon, or when the owner marked it high priority with no date.
 */

export const ATTENTION_LIMIT = 3;
export const DUE_SOON_DAYS = 7;

export type TaskAttentionState = "overdue" | "due_soon" | "high_priority";

export type AttentionItem =
  | {
      kind: "conversation";
      conversationId: string;
      title: string;
      plannedFor: string | null;
      participantName: string | null;
    }
  | {
      kind: "task";
      taskId: string;
      title: string;
      dueDate: string | null;
      state: TaskAttentionState;
    };

/** Adds whole days to an ISO calendar date (YYYY-MM-DD). Calendar arithmetic only, so no time zone applies. */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The earliest open conversation with a planned date; undated open conversations come after. */
function nextOpenConversation(items: readonly OwnerSummaryWire[]): OwnerSummaryWire | null {
  const open = items.filter((item) => item.status === "open");
  const sorted = [...open].sort((a, b) => {
    if (a.plannedFor === b.plannedFor) return 0;
    if (a.plannedFor === null) return 1;
    if (b.plannedFor === null) return -1;
    return a.plannedFor.localeCompare(b.plannedFor);
  });
  return sorted[0] ?? null;
}

export function buildAttentionItems(input: {
  conversations: readonly OwnerSummaryWire[];
  tasks: readonly TaskDto[];
  todayIso: string;
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  const next = nextOpenConversation(input.conversations);
  if (next !== null) {
    items.push({
      kind: "conversation",
      conversationId: next.conversationId,
      title: next.title,
      plannedFor: next.plannedFor,
      participantName: next.participant.displayName,
    });
  }

  const horizon = addDays(input.todayIso, DUE_SOON_DAYS);
  const open = input.tasks.filter((task) => task.status !== "done");

  const dated = open.flatMap((task) => (task.dueDate !== null && task.dueDate <= horizon ? [{ task, dueDate: task.dueDate }] : []));
  dated.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  for (const { task, dueDate } of dated) {
    items.push({
      kind: "task",
      taskId: task.id,
      title: task.title,
      dueDate,
      state: dueDate < input.todayIso ? "overdue" : "due_soon",
    });
  }

  const undatedHigh = open.filter((task) => task.priority === "high" && task.dueDate === null);
  for (const task of undatedHigh) {
    items.push({ kind: "task", taskId: task.id, title: task.title, dueDate: null, state: "high_priority" });
  }

  return items.slice(0, ATTENTION_LIMIT);
}

/** Open tasks, for the count tile: every task that is not completed. */
export function countOpenTasks(tasks: readonly TaskDto[]): number {
  return tasks.filter((task) => task.status !== "done").length;
}

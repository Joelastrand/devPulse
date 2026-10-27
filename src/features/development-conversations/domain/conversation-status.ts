/** Conversation lifecycle (SPEC BR-4). There is no draft, scheduled, cancelled or reopened state. */
export const CONVERSATION_STATUSES = ["open", "completed"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export function isConversationStatus(value: unknown): value is ConversationStatus {
  return typeof value === "string" && (CONVERSATION_STATUSES as readonly string[]).includes(value);
}

export type TransitionResult = { ok: true; status: "completed" } | { ok: false; error: "invalid_transition" };

/**
 * The only legal transition is `open → completed` (BR-4, BR-28). Completing an already completed conversation
 * is `invalid_transition`. Any other request is not a transition at all and is rejected by the caller's
 * allow-list before it reaches here.
 */
export function completeStatus(current: ConversationStatus): TransitionResult {
  if (current !== "open") {
    return { ok: false, error: "invalid_transition" };
  }
  return { ok: true, status: "completed" };
}

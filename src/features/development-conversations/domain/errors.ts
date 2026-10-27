/**
 * Stable D2 error codes (SPEC "Stable errors"). These are the only error codes a conversation operation or
 * route may return. No raw Firebase, Firestore, crypto or stack text is ever part of an error.
 */
export const CONVERSATION_ERROR_CODES = [
  "unauthenticated",
  "conversation_not_found",
  "invalid_input",
  "payload_too_large",
  "invalid_goal_selection",
  "invalid_participant",
  "conversation_completed",
  "invalid_transition",
  "conversation_limit",
  "persistence_failed",
] as const;

export type ConversationErrorCode = (typeof CONVERSATION_ERROR_CODES)[number];

/** HTTP status for each stable code (SPEC "Stable errors" table). Exhaustive by type. */
export const CONVERSATION_ERROR_STATUS: Record<ConversationErrorCode, number> = {
  unauthenticated: 401,
  conversation_not_found: 404,
  invalid_input: 400,
  payload_too_large: 413,
  invalid_goal_selection: 400,
  invalid_participant: 400,
  conversation_completed: 409,
  invalid_transition: 409,
  conversation_limit: 409,
  persistence_failed: 500,
};

export function isConversationErrorCode(value: unknown): value is ConversationErrorCode {
  return typeof value === "string" && (CONVERSATION_ERROR_CODES as readonly string[]).includes(value);
}

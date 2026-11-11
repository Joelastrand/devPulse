/**
 * Stable D2 error codes (SPEC "Stable errors"). These are the only error codes a conversation operation or
 * route may return. No raw Firebase, Firestore, crypto or stack text is ever part of an error.
 *
 * `auth_unavailable` and `erasure_in_progress` (TASK-009, TASK-027) are not listed here. They come only from the shared auth refusal
 * mapping (`src/features/auth/server/auth-refusal.ts`), so the approved table below stays exact. An owner write refused by the
 * erasure fence is answered through {@link conversationResponseStatus}, which gives it that mapping's 403.
 */
export const CONVERSATION_ERROR_CODES = [
  "unauthenticated",
  "conversation_not_found",
  "invalid_input",
  "payload_too_large",
  "invalid_goal_selection",
  "invalid_evidence_selection",
  "invalid_participant",
  "conversation_completed",
  "conversation_changed",
  "invalid_transition",
  "conversation_limit",
  "persistence_failed",
] as const;

export type ConversationErrorCode = (typeof CONVERSATION_ERROR_CODES)[number];

/** A code a conversation response can carry: a stable D2 code, or the erasure fence refusal (TASK-027). */
export type ConversationResponseCode = ConversationErrorCode | "erasure_in_progress";

/** HTTP status for each stable code (SPEC "Stable errors" table). Exhaustive by type. */
export const CONVERSATION_ERROR_STATUS: Record<ConversationErrorCode, number> = {
  unauthenticated: 401,
  conversation_not_found: 404,
  invalid_input: 400,
  payload_too_large: 413,
  invalid_goal_selection: 400,
  invalid_evidence_selection: 400,
  invalid_participant: 400,
  conversation_completed: 409,
  conversation_changed: 409,
  invalid_transition: 409,
  conversation_limit: 409,
  persistence_failed: 500,
};

/** The HTTP status for a response code. The fence refusal is the shared auth mapping's 403 (SPEC D-AUTHFAIL). */
export function conversationResponseStatus(code: ConversationResponseCode): number {
  return code === "erasure_in_progress" ? 403 : CONVERSATION_ERROR_STATUS[code];
}

export function isConversationErrorCode(value: unknown): value is ConversationErrorCode {
  return typeof value === "string" && (CONVERSATION_ERROR_CODES as readonly string[]).includes(value);
}

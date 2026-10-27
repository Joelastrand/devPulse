import type { UpdateConversationResult } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";

/**
 * What one owner write means for the person (SPEC Stable errors; TASK-025 gateway semantics). `saved` needs no message
 * of its own, because each caller shows its own success copy. `rejected` is a stable validation answer, and nothing
 * changed. `reread` means the authoritative state must be read again before the person acts on it.
 */
export type WriteOutcome =
  | { kind: "saved" }
  | { kind: "signed_out" }
  | { kind: "rejected"; message: string }
  | { kind: "reread"; message: string };

/**
 * Maps one gateway write result. Only the codes a section or goal write can return are named. Anything else, including a
 * read failure after a write, is treated as possibly applied: the copy never claims the write failed, and the caller
 * re-reads. No automatic retry is ever made.
 */
export function writeOutcome(result: UpdateConversationResult): WriteOutcome {
  if (result.status === "unauthenticated") return { kind: "signed_out" };
  if (result.status === "saved" || result.status === "unchanged") return { kind: "saved" };
  switch (result.error) {
    case "invalid_input":
    case "payload_too_large":
      return { kind: "rejected", message: conversationsCopy.writeInvalid };
    case "invalid_goal_selection":
      return { kind: "rejected", message: conversationsCopy.goalSelectionInvalid };
    case "conversation_completed":
      return { kind: "reread", message: conversationsCopy.writeCompleted };
    case "conversation_not_found":
      return { kind: "reread", message: conversationsCopy.writeNotFound };
    // A refused selection is neutral, and the owner's team list is read again with the conversation (TASK-029).
    case "invalid_participant":
      return { kind: "reread", message: conversationsCopy.participantInvalid };
    default:
      return { kind: "reread", message: conversationsCopy.writeAmbiguous };
  }
}

import type { AcceptInvitationResult, EndParticipationResult, SaveParticipantNotesResult } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";
import type { WriteOutcome } from "./owner-write-outcome";

/**
 * What one participation request means (SPEC BR-15, BR-17; TASK-030). `confirmed` is an answer the server gave. `not_found`
 * is the uniform refusal, which writes nothing. `unknown` covers every other failure, including a read failure and a
 * persistence failure, so the write may still have been applied. The caller then re-reads once and never sends again.
 */
export type ParticipationOutcome = { kind: "confirmed" } | { kind: "signed_out" } | { kind: "not_found" } | { kind: "unknown" };

export function acceptOutcome(result: AcceptInvitationResult): ParticipationOutcome {
  if (result.status === "unauthenticated") return { kind: "signed_out" };
  if (result.status === "accepted") return { kind: "confirmed" };
  return refusalOutcome(result.error);
}

/** Decline (pending) and leave (accepted) are one route, so one mapping serves both. */
export function endOutcome(result: EndParticipationResult): ParticipationOutcome {
  if (result.status === "unauthenticated") return { kind: "signed_out" };
  if (result.status === "ended") return { kind: "confirmed" };
  return refusalOutcome(result.error);
}

function refusalOutcome(error: string): ParticipationOutcome {
  return error === "conversation_not_found" ? { kind: "not_found" } : { kind: "unknown" };
}

/**
 * What one `participantNotes` save means (SPEC BR-20, Stable errors). Only the codes a notes save can return are named.
 * A save that may have been applied asks for one re-read, and a rejected one changes nothing.
 */
export function participantNotesOutcome(result: SaveParticipantNotesResult): WriteOutcome {
  if (result.status === "unauthenticated") return { kind: "signed_out" };
  if (result.status === "saved") return { kind: "saved" };
  switch (result.error) {
    case "invalid_input":
    case "payload_too_large":
      return { kind: "rejected", message: conversationsCopy.writeInvalid };
    case "conversation_completed":
      return { kind: "reread", message: conversationsCopy.writeCompleted };
    case "conversation_not_found":
      return { kind: "reread", message: conversationsCopy.writeNotFound };
    default:
      return { kind: "reread", message: conversationsCopy.writeAmbiguous };
  }
}

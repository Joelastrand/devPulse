"use client";

import { useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { updateConversation, type OwnerPatchInput } from "../client/conversations-gateway";
import { writeOutcome } from "./owner-write-outcome";

/** The message a write leaves beside its control. `success` and `error` only decide the alert style. */
export interface WriteFeedbackState {
  tone: "success" | "error";
  message: string;
}

export interface OwnerWriteContext {
  token: string;
  conversationId: string;
  onUnauthenticated: () => void;
  /** Re-reads the authoritative conversation. Called after a write that may have changed it. */
  onChanged: () => Promise<void>;
}

export interface OwnerWrite {
  pending: boolean;
  feedback: WriteFeedbackState | undefined;
  /** Attached to the element that holds the feedback, so focus moves there once a write ends. */
  feedbackRef: RefObject<HTMLDivElement | null>;
  /** Sends one owner write. A second call while one is in flight is refused, so one action sends one request. */
  /** Resolves `true` only when the server confirmed the write. A caller uses it to reset its draft to the saved value. */
  write: (input: OwnerPatchInput, savedMessage: string) => Promise<boolean>;
}

/**
 * One owner write for one editor section (SPEC BR-19, BR-49; TASK-028). The same-tick `inFlight` ref refuses a second
 * submit before the first render. A write is never retried automatically. After any write that the server accepted or
 * that may have been applied, the authoritative conversation is read again. Focus goes to the feedback once the write
 * ends, because the control that held focus is disabled while the write is pending.
 */
export function useOwnerWrite({ token, conversationId, onUnauthenticated, onChanged }: OwnerWriteContext): OwnerWrite {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<WriteFeedbackState>();
  const inFlight = useRef(false);
  const feedbackRef = useRef<HTMLDivElement>(null);

  async function write(input: OwnerPatchInput, savedMessage: string): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    setFeedback(undefined);

    const outcome = writeOutcome(await updateConversation(token, conversationId, input));
    inFlight.current = false;

    if (outcome.kind === "signed_out") {
      setPending(false);
      onUnauthenticated();
      return false;
    }
    const next: WriteFeedbackState =
      outcome.kind === "saved" ? { tone: "success", message: savedMessage } : { tone: "error", message: outcome.message };
    // Flushed now, so the control is enabled in the DOM before focus moves to the feedback.
    flushSync(() => {
      setPending(false);
      setFeedback(next);
    });
    feedbackRef.current?.focus();

    if (outcome.kind !== "rejected") await onChanged();
    return outcome.kind === "saved";
  }

  return { pending, feedback, feedbackRef, write };
}

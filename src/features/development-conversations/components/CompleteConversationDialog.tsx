"use client";

import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { updateConversation, type OwnerParticipantState } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";
import { useSingleFlight } from "./use-single-flight";

interface CompleteConversationDialogProps {
  conversationId: string;
  token: string;
  /** The server's participant state, so the consequence named here is the one that applies. */
  participantState: OwnerParticipantState;
  /** Must be stable: the owner page passes the same handler for every section. */
  onUnauthenticated: () => void;
  /** Re-reads the authoritative conversation after a completion whose outcome is known or unknown. */
  onChanged: () => Promise<void>;
}

/** What the person is told after a refused or uncertain completion. Only the copy changes; the server decides the state. */
interface Notice {
  tone: "info" | "error";
  message: string;
}

/**
 * Owner completion (SPEC BR-4, BR-13, BR-28, CL-25; TASK-031). Completion is one `open → completed` change with no undo.
 * The confirmation states what it does before anything is sent. A confirmed completion re-reads the conversation, and the
 * completed view replaces this control. Completion is never sent again from here. An uncertain result is re-read once, and
 * the copy claims neither success nor failure.
 */
export function CompleteConversationDialog({ conversationId, token, participantState, onUnauthenticated, onChanged }: CompleteConversationDialogProps) {
  const { pending, run } = useSingleFlight();
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const openWrapper = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLParagraphElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const wasConfirming = useRef(false);

  // Focus moves to the consequence when the confirmation opens, and back to the open control when it closes.
  useEffect(() => {
    if (confirming) titleRef.current?.focus();
    else if (wasConfirming.current) openWrapper.current?.querySelector<HTMLButtonElement>("button")?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  /** A form submit, so a second submit in the same tick reaches the guard before any re-render disables the control. */
  function sendConfirmed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      const result = await updateConversation(token, conversationId, { status: "completed" });
      if (result.status === "unauthenticated") {
        onUnauthenticated();
        return;
      }
      if (result.status === "saved" || result.status === "unchanged") {
        setConfirming(false);
        await onChanged();
        return;
      }
      setNotice(refusalNotice(result.error));
      await onChanged();
    });
  }

  if (!confirming) {
    return (
      <div ref={openWrapper}>
        <Button type="button" onClick={() => setConfirming(true)}>
          {conversationsCopy.completeConversationButton}
        </Button>
      </div>
    );
  }

  return (
    <form
      noValidate
      role="group"
      aria-labelledby="complete-confirm-title"
      onSubmit={sendConfirmed}
      className="flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800"
    >
      <p id="complete-confirm-title" ref={titleRef} tabIndex={-1} className="font-medium text-zinc-900 outline-none dark:text-zinc-50">
        {conversationsCopy.completeConfirmHeading}
      </p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-zinc-900 dark:text-zinc-50">
        <li>{conversationsCopy.completeReadOnly}</li>
        <li>{conversationsCopy.completeNoReopen}</li>
        <li>{conversationsCopy.completeRemovalStillAvailable}</li>
        <li>{conversationsCopy.completeUnsavedLost}</li>
        {participantState === "pending" && <li>{conversationsCopy.completePendingWithdrawn}</li>}
        {participantState === "accepted" && <li>{conversationsCopy.completeAcceptedKeeps}</li>}
      </ul>
      {notice && <Feedback notice={notice} regionRef={noticeRef} />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" pending={pending}>
          {pending ? conversationsCopy.completing : conversationsCopy.confirmComplete}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
          {conversationsCopy.keepOpen}
        </Button>
      </div>
    </form>
  );
}

/**
 * The copy for a refused or uncertain completion. A stable refusal that says the conversation is already finished, or that
 * it is gone, is stated as such. Every other outcome is uncertain, so the copy claims neither success nor failure.
 */
function refusalNotice(error: string): Notice {
  if (error === "invalid_transition" || error === "conversation_completed") {
    return { tone: "info", message: conversationsCopy.completeAlreadyDone };
  }
  if (error === "conversation_not_found") {
    return { tone: "error", message: conversationsCopy.writeNotFound };
  }
  return { tone: "error", message: conversationsCopy.completeNotConfirmed };
}

function Feedback({ notice, regionRef }: { notice: Notice; regionRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={regionRef} tabIndex={-1} className="outline-none">
      <Alert variant={notice.tone}>{notice.message}</Alert>
    </div>
  );
}

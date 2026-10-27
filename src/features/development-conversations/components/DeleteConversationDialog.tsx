"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { deleteConversation } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";
import { useSingleFlight } from "./use-single-flight";

interface DeleteConversationDialogProps {
  conversationId: string;
  token: string;
  /** Must be stable: the owner page passes the same handler for every section. */
  onUnauthenticated: () => void;
  /** Re-reads the authoritative conversation after a delete whose outcome is unknown. */
  onChanged: () => Promise<void>;
}

/** The list is where the owner goes once the conversation is gone. `replace` keeps the deleted detail out of history. */
const LIST_PATH = "/me/conversations";

/**
 * The owner's permanent delete (SPEC BR-5, BR-29, BR-38; TASK-031). The control opens a confirmation that states the
 * consequence first. A confirmed delete sends one `DELETE`, and a second submit in the same tick is refused by the guard.
 * A `conversation_not_found` answer means the owner no longer has the conversation, so the list is shown. Any other
 * uncertain result is never sent again: the conversation is read once more, and the person decides what to do next.
 */
export function DeleteConversationDialog({ conversationId, token, onUnauthenticated, onChanged }: DeleteConversationDialogProps) {
  const router = useRouter();
  const { pending, run } = useSingleFlight();
  const [confirming, setConfirming] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const openWrapper = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLParagraphElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const wasConfirming = useRef(false);

  // Focus moves to the consequence when the confirmation opens, and back to the open control when it closes.
  useEffect(() => {
    if (confirming) titleRef.current?.focus();
    else if (wasConfirming.current) openWrapper.current?.querySelector<HTMLButtonElement>("button")?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  useEffect(() => {
    if (uncertain) feedbackRef.current?.focus();
  }, [uncertain]);

  /** A form submit, so a second submit in the same tick reaches the guard before any re-render disables the control. */
  function sendConfirmed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      const result = await deleteConversation(token, conversationId);
      if (result.status === "unauthenticated") {
        onUnauthenticated();
        return;
      }
      if (result.status === "deleted" || result.error === "conversation_not_found") {
        router.replace(LIST_PATH);
        return;
      }
      // persistence_failed and unknown: the delete may have been applied, so it is not sent again.
      setUncertain(true);
      await onChanged();
    });
  }

  if (!confirming) {
    return (
      <div ref={openWrapper}>
        <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
          {conversationsCopy.deleteConversationButton}
        </Button>
      </div>
    );
  }

  return (
    <form
      noValidate
      role="group"
      aria-labelledby="delete-confirm-title"
      onSubmit={sendConfirmed}
      className="flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800"
    >
      <p id="delete-confirm-title" ref={titleRef} tabIndex={-1} className="font-medium text-zinc-900 outline-none dark:text-zinc-50">
        {conversationsCopy.deleteConfirmHeading}
      </p>
      <p className="text-sm text-zinc-900 dark:text-zinc-50">{conversationsCopy.deleteConsequence}</p>
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{conversationsCopy.deleteIrreversible}</p>
      {uncertain && (
        <div ref={feedbackRef} tabIndex={-1} className="outline-none">
          <Alert variant="error">{conversationsCopy.deleteNotConfirmed}</Alert>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" size="sm" pending={pending}>
          {pending ? conversationsCopy.deletingLabel : conversationsCopy.confirmDelete}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
          {conversationsCopy.keepConversation}
        </Button>
      </div>
    </form>
  );
}

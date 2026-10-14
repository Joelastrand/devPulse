"use client";

import { useEffect, useRef, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { goalsCopy } from "../copy";

interface DeleteConfirmationProps {
  /** What is being deleted, in words the person can recognise (a goal title is inert text; a recovery item names none). */
  message: string;
  /** Resolves to an error message to show (the confirmation stays open), or `undefined` once the delete went through. */
  onConfirm: () => Promise<string | undefined>;
  onCancel: () => void;
}

/** Inline permanent-delete confirmation shared by goals and recovery items (BR-52, BR-61). Focus moves to its message. */
export function DeleteConfirmation({ message, onConfirm, onCancel }: DeleteConfirmationProps) {
  const text = useRef<HTMLParagraphElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    text.current?.focus();
  }, []);

  async function confirm() {
    if (pending) return;
    setPending(true);
    setError(undefined);
    const failure = await onConfirm();
    setPending(false);
    if (failure !== undefined) setError(failure);
  }

  return (
    <div role="group" aria-labelledby="delete-confirmation-message" className="flex flex-col gap-2">
      <p
        id="delete-confirmation-message"
        ref={text}
        tabIndex={-1}
        className="break-words text-sm font-medium text-zinc-900 outline-none dark:text-zinc-50"
      >
        {message}
      </p>
      {error && <Alert variant="error">{error}</Alert>}
      <div className="flex gap-2">
        <Button variant="destructive" size="sm" pending={pending} onClick={() => void confirm()}>
          {pending ? goalsCopy.deleteConfirmPending : goalsCopy.deleteConfirmButton}
        </Button>
        <Button variant="secondary" size="sm" disabled={pending} onClick={onCancel}>
          {goalsCopy.cancelButton}
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/TextField";
import { createConversation } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";
import { isValidPlanDate } from "../domain/plan-date";
import { normalizeTitle } from "../domain/text-rules";

/** Id of the page-header trigger that opens this panel. Focus returns to it when the panel closes. */
export const CREATE_TRIGGER_ID = "new-conversation-trigger";
export const CREATE_PANEL_ID = "create-conversation-panel";

interface FieldErrors {
  title?: string;
  plannedFor?: string;
}

interface CreateConversationFormProps {
  /** Controlled by the list page, whose header holds the one primary action. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  onUnauthenticated: () => void;
  /** Re-reads the authoritative list after a create that may have changed it. */
  onChanged: () => Promise<void>;
}

/**
 * The compact create panel (SPEC BR-1, BR-2, BR-6, BR-38, BR-39; TASK-027, A2.1). It has two fields and no team or participant.
 * Create is the only write here. Client rules mirror the domain rules for immediate feedback; the server result is
 * authoritative. A create is never retried automatically: a failed or unknown outcome re-reads the list and asks the person to
 * check it before trying again. The server returns only a code for invalid input, so no field name is ever shown for it.
 */
export function CreateConversationForm({ open, onOpenChange, token, onUnauthenticated, onChanged }: CreateConversationFormProps) {
  const [title, setTitle] = useState("");
  const [plannedFor, setPlannedFor] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  /** Set synchronously, so a second submit before the first re-render is still refused. */
  const inFlight = useRef(false);

  function resetForm() {
    setTitle("");
    setPlannedFor("");
    setFieldErrors({});
    setFormError(undefined);
    onOpenChange(false);
    // The focused control inside the form is removed on close, so focus goes back to the page-header trigger.
    document.getElementById(CREATE_TRIGGER_ID)?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    const normalized = normalizeTitle(title);
    const errors: FieldErrors = {};
    if (!normalized.ok) errors.title = conversationsCopy.createTitleInvalid;
    if (plannedFor !== "" && !isValidPlanDate(plannedFor)) errors.plannedFor = conversationsCopy.createDateInvalid;
    setFieldErrors(errors);
    setFormError(undefined);
    if (!normalized.ok || errors.title || errors.plannedFor) return;

    inFlight.current = true;
    setPending(true);
    const result = await createConversation(token, {
      title: normalized.text,
      plannedFor: plannedFor === "" ? null : plannedFor,
    });
    inFlight.current = false;
    // Flushed now, so the submit control is enabled in the DOM before a success moves focus back to the trigger.
    flushSync(() => setPending(false));

    if (result.status === "created") {
      resetForm();
      await onChanged();
      return;
    }
    if (result.status === "unauthenticated") {
      onUnauthenticated();
      return;
    }
    if (result.error === "conversation_limit") {
      setFormError(conversationsCopy.createLimit);
      return;
    }
    if (result.error === "invalid_input" || result.error === "payload_too_large") {
      setFormError(conversationsCopy.createInvalidInput);
      return;
    }
    // persistence_failed, read_failed and unknown may still have created the conversation: no automatic retry, re-read.
    setFormError(conversationsCopy.createAmbiguous);
    await onChanged();
  }

  if (!open) return null;

  return (
    <form
      id={CREATE_PANEL_ID}
      aria-label={conversationsCopy.createHeading}
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-surface border border-border-subtle bg-surface p-4 shadow-card"
    >
      <p className="text-sm text-text-secondary">{conversationsCopy.createPrivacy}</p>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)] sm:items-start">
        <TextField
          id="create-title"
          label={conversationsCopy.createTitleLabel}
          required
          autoComplete="off"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          error={fieldErrors.title}
        />

        <TextField
          id="create-planned-for"
          type="date"
          label={conversationsCopy.plannedForLabel}
          description={conversationsCopy.createDateHint}
          value={plannedFor}
          onChange={(event) => setPlannedFor(event.target.value)}
          error={fieldErrors.plannedFor}
        />
      </div>

      {formError && <Alert variant="error">{formError}</Alert>}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" pending={pending}>
          {pending ? conversationsCopy.createPending : conversationsCopy.createSubmit}
        </Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={resetForm}>
          {conversationsCopy.cancelCreate}
        </Button>
      </div>
    </form>
  );
}

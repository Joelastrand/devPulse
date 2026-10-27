"use client";

import { useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Select } from "../../../components/ui/Select";
import { TextField } from "../../../components/ui/TextField";
import { createConversation, fetchCreateOptions, type CreateTeamChoiceWire } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";
import { isValidPlanDate } from "../domain/plan-date";
import { normalizeTitle } from "../domain/text-rules";

const PANEL_ID = "create-conversation-panel";

/**
 * The team choice loads when the form opens. The server decides which teams are eligible (SPEC create-options contract).
 * `unavailable` is a failed read, which is not the same as `ready` with no options.
 */
type TeamState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; teams: CreateTeamChoiceWire[]; truncated: boolean }
  | { phase: "unavailable" };

interface FieldErrors {
  title?: string;
  plannedFor?: string;
}

interface CreateConversationFormProps {
  token: string;
  onUnauthenticated: () => void;
  /** Re-reads the authoritative list after a create that may have changed it. */
  onChanged: () => Promise<void>;
}

/**
 * The create disclosure on the list page (SPEC BR-1, BR-2, BR-6, BR-38, BR-39; TASK-027). Create is the only write here.
 * Client rules mirror the domain rules for immediate feedback; the server result is authoritative. A create is never
 * retried automatically: a failed or unknown outcome re-reads the list and asks the person to check it before trying
 * again. The server returns only a code for invalid input, so no field name is ever shown for it.
 */
export function CreateConversationForm({ token, onUnauthenticated, onChanged }: CreateConversationFormProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [plannedFor, setPlannedFor] = useState("");
  const [teamId, setTeamId] = useState("");
  const [teams, setTeams] = useState<TeamState>({ phase: "idle" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  /** Set synchronously, so a second submit before the first re-render is still refused. */
  const inFlight = useRef(false);
  /** The wrapper, not the button: `Button` does not forward refs. Used only to return focus when the form closes. */
  const toggleAreaRef = useRef<HTMLDivElement>(null);
  /**
   * Identifies the latest team-options request. A response from an earlier open, or from before a close, is discarded,
   * so it can never overwrite the state of a newer open.
   */
  const teamRequest = useRef(0);

  function resetForm() {
    teamRequest.current += 1;
    setTitle("");
    setPlannedFor("");
    setTeamId("");
    setTeams({ phase: "idle" });
    setFieldErrors({});
    setFormError(undefined);
    setOpen(false);
    // The focused control inside the form is removed on close, so focus goes back to the disclosure.
    toggleAreaRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }

  async function openForm() {
    const request = ++teamRequest.current;
    setOpen(true);
    setTeams({ phase: "loading" });
    const result = await fetchCreateOptions(token);
    if (request !== teamRequest.current) return;
    if (result.status === "unauthenticated") {
      onUnauthenticated();
      return;
    }
    setTeams(
      result.status === "ok"
        ? { phase: "ready", teams: result.response.items, truncated: result.response.truncated }
        : { phase: "unavailable" },
    );
  }

  function toggle() {
    if (open) {
      resetForm();
    } else {
      void openForm();
    }
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
      ...(teamId === "" ? {} : { teamId }),
    });
    inFlight.current = false;
    // Flushed now, so the disclosure is enabled in the DOM before a success moves focus back to it.
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

  return (
    <div className="flex flex-col gap-4">
      <div ref={toggleAreaRef}>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-expanded={open}
          aria-controls={open ? PANEL_ID : undefined}
          disabled={pending}
          onClick={toggle}
        >
          {conversationsCopy.createToggle}
        </Button>
      </div>

      {open && (
        <form
          id={PANEL_ID}
          aria-label={conversationsCopy.createHeading}
          noValidate
          onSubmit={submit}
          className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <p className="text-sm text-zinc-700 dark:text-zinc-300">{conversationsCopy.createPrivacy}</p>

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

          {teams.phase === "ready" && teams.teams.length > 0 && (
            <Select
              id="create-team"
              label={conversationsCopy.teamLabel}
              description={conversationsCopy.createTeamHint}
              value={teamId}
              onChange={(event) => setTeamId(event.target.value)}
            >
              <option value="">{conversationsCopy.createNoTeam}</option>
              {teams.teams.map((team) => (
                <option key={team.teamId} value={team.teamId}>
                  {team.name}
                </option>
              ))}
            </Select>
          )}
          {teams.phase === "ready" && teams.truncated && <Alert variant="info">{conversationsCopy.createTeamTruncated}</Alert>}
          {teams.phase === "ready" && !teams.truncated && teams.teams.length === 0 && (
            <Alert variant="info">{conversationsCopy.createTeamNone}</Alert>
          )}
          {teams.phase === "unavailable" && <Alert variant="info">{conversationsCopy.createTeamUnavailable}</Alert>}

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
      )}
    </div>
  );
}

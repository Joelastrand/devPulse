"use client";

import { useEffect, useId, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { LoadingState } from "../../../components/ui/LoadingState";
import { TextField } from "../../../components/ui/TextField";
import { fetchInvitableColleagues, type ColleagueWire } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";

interface ColleaguePickerProps {
  token: string;
  /** Another write is in flight. The picker stays usable for reading but cannot send. */
  pending: boolean;
  /** Sends the invitation for the chosen opaque reference. The parent owns the write and its feedback. */
  onInvite: (memberRef: string) => void;
  /** A 401 from the list. The parent routes to sign-in, as for every other owner write. */
  onUnauthenticated: () => void;
}

type ListState = { status: "loading" } | { status: "error" } | { status: "ready"; colleagues: ColleagueWire[]; truncated: boolean };

/** Display-name match only. This is presentation, never authorization: the server decided who may appear in the list. */
function matchesQuery(colleague: ColleagueWire, query: string): boolean {
  if (query.length === 0) return true;
  return colleague.displayName !== null && colleague.displayName.toLocaleLowerCase("nb").includes(query);
}

/**
 * The owner's colleague picker (A2.1 revised, BR-9, BR-38). The list is loaded for the current token only, and a response that
 * arrives after the token changed is dropped, so one account never shows another's list. Choices are native radio buttons, so
 * keyboard and screen-reader behaviour comes from the platform. The selected colleague stays selected only while it is visible.
 *
 * Duplicate display names are not disambiguated. The server returns only a name and an opaque reference, and no other
 * identifying field is authorized for this list, so two colleagues with one name look the same. This is a known limitation.
 */
export function ColleaguePicker({ token, pending, onInvite, onUnauthenticated }: ColleaguePickerProps) {
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  /** The browse list is open. Typing a query opens it; hiding it closes the list but never clears the query. */
  const [expanded, setExpanded] = useState(false);
  const regionId = useId();
  const groupId = useId();
  const searchId = useId();
  const resultsId = useId();

  useEffect(() => {
    let active = true;
    fetchInvitableColleagues(token).then((result) => {
      if (!active) return;
      if (result.status === "unauthenticated") {
        onUnauthenticated();
        return;
      }
      if (result.status === "error") {
        setState({ status: "error" });
        return;
      }
      setState({ status: "ready", colleagues: result.response.colleagues, truncated: result.response.truncated });
    });
    return () => {
      active = false;
    };
  }, [token, onUnauthenticated, attempt]);

  if (state.status === "loading") {
    return (
      <div aria-live="polite">
        <LoadingState label={conversationsCopy.colleagueListLoading} />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="error">{conversationsCopy.colleagueListError}</Alert>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            setState({ status: "loading" });
            setAttempt((count) => count + 1);
          }}
        >
          {conversationsCopy.retryButton}
        </Button>
      </div>
    );
  }
  if (state.colleagues.length === 0) return <p className="text-text-secondary">{conversationsCopy.colleagueListEmpty}</p>;

  const needle = query.trim().toLocaleLowerCase("nb");
  const visible = state.colleagues.filter((colleague) => matchesQuery(colleague, needle));
  // A choice that the search hides is no longer chosen, so the submit can never send a colleague the user cannot see.
  // A selection counts only while its result is visible. Collapsing the list therefore disables the invite action, so a
  // hidden colleague can never be sent. The same rule covers search: a hidden choice is not chosen.
  const chosen = expanded ? (visible.find((colleague) => colleague.memberRef === selected) ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      {state.truncated && <Alert variant="info">{conversationsCopy.colleagueListTruncated}</Alert>}

      <TextField
        id={searchId}
        label={conversationsCopy.colleagueSearchLabel}
        type="search"
        autoComplete="off"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          // Searching always shows the matches, even after the list was collapsed.
          if (event.target.value.trim() !== "") setExpanded(true);
        }}
      />

      <div className="flex flex-col items-start gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-expanded={expanded}
          aria-controls={regionId}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? conversationsCopy.colleagueHideButton : conversationsCopy.colleagueBrowseButton}
        </Button>
        {!expanded && <p className="text-sm text-text-secondary">{conversationsCopy.colleagueSearchPrompt}</p>}
      </div>

      <div id={regionId} hidden={!expanded} className="flex flex-col gap-4">
      {visible.length === 0 ? (
        <p className="text-text-secondary" aria-live="polite">
          {conversationsCopy.colleagueSearchEmpty}
        </p>
      ) : (
        <fieldset className="flex flex-col gap-2" aria-describedby={resultsId}>
          <legend className="mb-2 text-sm font-medium text-text-primary">{conversationsCopy.colleaguePickerHint}</legend>
          <p id={resultsId} className="sr-only" aria-live="polite">
            {conversationsCopy.colleagueResultCount(visible.length)}
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {visible.map((colleague) => {
              const inputId = `${groupId}-${colleague.memberRef}`;
              const isChosen = chosen?.memberRef === colleague.memberRef;
              return (
                <li key={colleague.memberRef}>
                  <label
                    htmlFor={inputId}
                    className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 ${
                      isChosen ? "border-primary bg-primary-subtle" : "border-border-subtle bg-surface hover:bg-surface-muted"
                    }`}
                  >
                    <input
                      id={inputId}
                      type="radio"
                      name={groupId}
                      value={colleague.memberRef}
                      checked={isChosen}
                      disabled={pending}
                      onChange={() => setSelected(colleague.memberRef)}
                      className="size-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0 break-words text-text-primary">
                      {colleague.displayName ?? conversationsCopy.colleagueUnnamedOption}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}
      </div>

      {/* The confirmation names the choice in words before anything is sent, so the submit never acts on a hidden selection. */}
      <div className="flex flex-col gap-3 rounded-md border border-border-subtle bg-surface-muted p-4">
        <h3 className="text-sm font-semibold text-text-primary">{conversationsCopy.inviteConfirmHeading}</h3>
        <p className="text-sm text-text-secondary" aria-live="polite">
          {chosen === null
            ? conversationsCopy.inviteNoChoice
            : conversationsCopy.inviteTargetLine(chosen.displayName ?? conversationsCopy.colleagueUnnamedOption)}
        </p>
        <p className="text-sm text-text-secondary">{conversationsCopy.inviteSummaryLine}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="primary"
            disabled={chosen === null || pending}
            pending={pending}
            onClick={() => {
              if (chosen !== null) onInvite(chosen.memberRef);
            }}
          >
            {conversationsCopy.colleagueInviteSubmit}
          </Button>
        </div>
      </div>
    </div>
  );
}

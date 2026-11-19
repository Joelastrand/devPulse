"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActionsMenu } from "../../../components/ui/ActionsMenu";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { CountStrip } from "../../../components/ui/CountStrip";
import { EmptyState } from "../../../components/ui/EmptyState";
import { FilterChips } from "../../../components/ui/FilterChips";
import { StatusBadge, type StatusTone } from "../../../components/ui/StatusBadge";
import { TextField } from "../../../components/ui/TextField";
import { matchesSearchQuery } from "../../../components/ui/search-match";
import type { AdminSurveyEntry } from "../../surveys/client/admin-survey-gateway";
import { surveysCopy } from "../../surveys/copy";

/** Per-row state. `confirming_removal` is the inline confirmation for "Slett/arkiver", which runs only on explicit confirm. */
export type SurveyRowActionState =
  | { status: "idle" }
  | { status: "confirming_removal" }
  | { status: "pending" }
  | { status: "error"; message: string };

export type SurveyCopyState = "idle" | "success" | "failure";

export interface AdminSurveyListProps {
  entries: readonly AdminSurveyEntry[];
  actions: Readonly<Record<string, SurveyRowActionState>>;
  copyStateFor: (surveyId: string) => SurveyCopyState;
  onOpen: (surveyId: string) => void;
  onClose: (surveyId: string) => void;
  onRequestRemove: (surveyId: string) => void;
  onCancelRemove: (surveyId: string) => void;
  onConfirmRemove: (surveyId: string) => void;
  onCopyLink: (surveyId: string) => void;
}

type SurveyFilter = "all" | "scheduled" | "open" | "closed" | "archived";

const copy = surveysCopy.admin;

/** The survey page path. It is built only from the server-issued survey ID, never from client input. */
export function surveyLink(surveyId: string): string {
  return `/survey/${encodeURIComponent(surveyId)}`;
}

/**
 * Lifecycle and archive are read as one state per survey: `archived` only ever applies after a survey has closed, so the
 * filter values below are mutually exclusive and add up to the whole list. Nothing is inferred beyond those two fields.
 */
function stateOf(entry: AdminSurveyEntry): Exclude<SurveyFilter, "all"> {
  if (entry.archived) return "archived";
  return entry.lifecycle;
}

const STATE_TONE: Record<Exclude<SurveyFilter, "all">, StatusTone> = {
  scheduled: "info",
  open: "success",
  closed: "neutral",
  archived: "neutral",
};

const STATE_LABEL: Record<Exclude<SurveyFilter, "all">, string> = {
  scheduled: copy.lifecycleLabels.scheduled,
  open: copy.lifecycleLabels.open,
  closed: copy.lifecycleLabels.closed,
  archived: copy.archivedLabel,
};

/**
 * Survey list for the team administration `Undersøkelser` tab. Search and status filter run over the surveys already
 * loaded for this team (title and lifecycle only; no response data exists on these rows). The lifecycle buttons, the
 * copy-link action and the combined delete-or-archive operation keep their existing handlers and server semantics.
 */
export function AdminSurveyList({
  entries,
  actions,
  copyStateFor,
  onOpen,
  onClose,
  onRequestRemove,
  onCancelRemove,
  onConfirmRemove,
  onCopyLink,
}: AdminSurveyListProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SurveyFilter>("all");

  if (entries.length === 0) {
    return <EmptyState>{copy.empty}</EmptyState>;
  }

  const counts = {
    planned: entries.filter((entry) => stateOf(entry) === "scheduled").length,
    active: entries.filter((entry) => stateOf(entry) === "open").length,
    closed: entries.filter((entry) => stateOf(entry) === "closed").length,
    archived: entries.filter((entry) => entry.archived).length,
  };
  const matching = entries.filter(
    (entry) =>
      (filter === "all" || stateOf(entry) === filter) && matchesSearchQuery(query, [entry.title ?? null]),
  );
  const current = matching.filter((entry) => !entry.archived);
  const archived = matching.filter((entry) => entry.archived);
  const isSearching = query.trim() !== "";

  return (
    <div className="flex flex-col gap-4">
      <CountStrip
        items={[
          { label: copy.summaryLabels.planned, value: counts.planned },
          { label: copy.summaryLabels.active, value: counts.active },
          { label: copy.summaryLabels.closed, value: counts.closed },
          { label: copy.summaryLabels.archived, value: counts.archived },
        ]}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 sm:max-w-sm sm:flex-1">
          <TextField
            id="admin-survey-search"
            type="search"
            label={copy.searchLabel}
            value={query}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <FilterChips<SurveyFilter>
          label={copy.filterLabel}
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: copy.filterAll },
            { id: "scheduled", label: copy.summaryLabels.planned },
            { id: "open", label: copy.summaryLabels.active },
            { id: "closed", label: copy.summaryLabels.closed },
            { id: "archived", label: copy.summaryLabels.archived },
          ]}
        />
      </div>

      {matching.length === 0 ? (
        <EmptyState>
          {isSearching ? copy.noSearchMatches : copy.noFilterMatches}
        </EmptyState>
      ) : (
        <>
          {current.length > 0 && (
            <SurveyGroup title={copy.currentListTitle} count={current.length}>
              {current.map((entry) => (
                <SurveyRow
                  key={entry.surveyId}
                  entry={entry}
                  action={actions[entry.surveyId] ?? { status: "idle" }}
                  copyState={copyStateFor(entry.surveyId)}
                  onOpen={() => onOpen(entry.surveyId)}
                  onClose={() => onClose(entry.surveyId)}
                  onRequestRemove={() => onRequestRemove(entry.surveyId)}
                  onCancelRemove={() => onCancelRemove(entry.surveyId)}
                  onConfirmRemove={() => onConfirmRemove(entry.surveyId)}
                  onCopyLink={() => onCopyLink(entry.surveyId)}
                />
              ))}
            </SurveyGroup>
          )}
          {archived.length > 0 && (
            <SurveyGroup title={copy.archivedListTitle} count={archived.length}>
              {archived.map((entry) => (
                <SurveyRow
                  key={entry.surveyId}
                  entry={entry}
                  action={actions[entry.surveyId] ?? { status: "idle" }}
                  copyState={copyStateFor(entry.surveyId)}
                  onOpen={() => onOpen(entry.surveyId)}
                  onClose={() => onClose(entry.surveyId)}
                  onRequestRemove={() => onRequestRemove(entry.surveyId)}
                  onCancelRemove={() => onCancelRemove(entry.surveyId)}
                  onConfirmRemove={() => onConfirmRemove(entry.surveyId)}
                  onCopyLink={() => onCopyLink(entry.surveyId)}
                />
              ))}
            </SurveyGroup>
          )}
        </>
      )}
    </div>
  );
}

function SurveyGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-text-secondary">
        {title} <span className="font-normal tabular-nums">({count})</span>
      </h3>
      <ul className="divide-y divide-border-subtle rounded-surface border border-border-subtle bg-surface shadow-card">
        {children}
      </ul>
    </section>
  );
}

interface SurveyRowProps {
  entry: AdminSurveyEntry;
  action: SurveyRowActionState;
  copyState: SurveyCopyState;
  onOpen: () => void;
  onClose: () => void;
  onRequestRemove: () => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
  onCopyLink: () => void;
}

function SurveyRow({
  entry,
  action,
  copyState,
  onOpen,
  onClose,
  onRequestRemove,
  onCancelRemove,
  onConfirmRemove,
  onCopyLink,
}: SurveyRowProps) {
  const title = entry.title ?? copy.fallbackTitle;
  const state = stateOf(entry);
  const isPending = action.status === "pending";
  const confirming = action.status === "confirming_removal";
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const link = surveyLink(entry.surveyId);
  // Only a closed, not-yet-archived survey can be removed. The server then deletes it when it has no responses and archives it otherwise.
  const removable = entry.lifecycle === "closed" && !entry.archived;

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  const pendingLabel =
    action.status === "pending"
      ? entry.lifecycle === "scheduled"
        ? copy.openingButton
        : entry.lifecycle === "open"
          ? copy.closingButton
          : copy.removingButton
      : null;

  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-words font-semibold text-text-primary">{title}</span>
            <StatusBadge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</StatusBadge>
          </div>
          <p className="mt-1 text-sm text-text-secondary">
            {surveysCopy.admin.accessModeLabels[entry.accessMode]} · {copy.minimumResponsesSummary(entry.minimumResponses)}
          </p>
          {/* A subtle preview only. The full URL is available through the copy action, so it never dominates the row. */}
          <p className="mt-1 flex min-w-0 items-center gap-1 text-sm text-text-muted">
            <span className="shrink-0">{copy.linkLabel}</span>
            <Link href={link} title={link} className="min-w-0 truncate underline-offset-2 hover:underline">
              {link}
            </Link>
          </p>
          {pendingLabel !== null && (
            <p role="status" className="mt-1 text-sm text-text-secondary">
              {pendingLabel}
            </p>
          )}
          {action.status === "error" && (
            <Alert variant="error" className="mt-1 text-sm">
              {action.message}
            </Alert>
          )}
          {copyState === "failure" && (
            <Alert variant="error" className="mt-1 text-sm">
              {copy.linkCopyError}
            </Alert>
          )}
        </div>

        {!confirming && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:self-start">
            <Button
              variant="secondary"
              size="sm"
              aria-label={`${copyState === "success" ? copy.linkCopied : copy.copyLinkButton} – ${title}`}
              onClick={onCopyLink}
            >
              {copyState === "success" ? copy.linkCopied : copy.copyLinkButton}
            </Button>
            {entry.lifecycle === "scheduled" && !entry.archived && (
              <Button
                variant="secondary"
                size="sm"
                pending={isPending}
                aria-label={`${isPending ? copy.openingButton : copy.openButton} – ${title}`}
                onClick={onOpen}
              >
                {isPending ? copy.openingButton : copy.openButton}
              </Button>
            )}
            {entry.lifecycle === "open" && (
              <Button
                variant="secondary"
                size="sm"
                pending={isPending}
                aria-label={`${isPending ? copy.closingButton : copy.closeButton} – ${title}`}
                onClick={onClose}
              >
                {isPending ? copy.closingButton : copy.closeButton}
              </Button>
            )}
            {removable && (
              <ActionsMenu
                label={`${copy.menuLabel} – ${title}`}
                title={copy.menuLabel}
                disabled={isPending}
                items={[
                  {
                    key: "remove",
                    label: copy.removeButton,
                    destructive: true,
                    onSelect: onRequestRemove,
                  },
                ]}
              />
            )}
          </div>
        )}
      </div>

      {confirming && (
        <div className="flex flex-col gap-2 rounded-control border border-danger-text/40 bg-danger-subtle p-3">
          <p className="text-sm text-text-primary">{copy.removeConfirmPrompt}</p>
          <div className="flex flex-wrap gap-2">
            <Button ref={cancelRef} variant="secondary" size="sm" onClick={onCancelRemove}>
              {copy.removeCancelButton}
            </Button>
            <Button variant="destructive" size="sm" onClick={onConfirmRemove}>
              {copy.removeConfirmButton}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

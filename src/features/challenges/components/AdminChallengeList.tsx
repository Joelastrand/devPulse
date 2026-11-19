"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { ActionsMenu, type ActionMenuItem } from "../../../components/ui/ActionsMenu";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { CountStrip } from "../../../components/ui/CountStrip";
import { EmptyState } from "../../../components/ui/EmptyState";
import { FilterChips } from "../../../components/ui/FilterChips";
import { Icon } from "../../../components/ui/Icon";
import { LoadingState } from "../../../components/ui/LoadingState";
import { StatusBadge, type StatusTone } from "../../../components/ui/StatusBadge";
import { TextField } from "../../../components/ui/TextField";
import { matchesSearchQuery } from "../../../components/ui/search-match";
import { formatSurveyDate } from "../../results/domain/format-survey-date";
import type { AdminChallengeView } from "../client/admin-challenges-gateway";
import { challengesCopy } from "../copy";

export type AdminChallengeListState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; challenges: AdminChallengeView[] };

/**
 * Per-challenge admin action state — mirrors the survey row pattern in `AdminTeamDetail`. Only one action is ever pending
 * for a given row at a time. `confirming_deletion` is its own phase, distinct from `pending`, so the destructive delete
 * call never fires before an explicit confirmation.
 */
export type AdminChallengeRowActionState =
  | { status: "idle" }
  | { status: "confirming_deletion" }
  | { status: "pending"; action: "resolve" | "archive" | "delete" }
  | { status: "error"; message: string };

export interface AdminChallengeListProps {
  state: AdminChallengeListState;
  actions: Record<string, AdminChallengeRowActionState>;
  onResolve: (challengeId: string) => void;
  onArchive: (challengeId: string) => void;
  onRequestDelete: (challengeId: string) => void;
  onCancelDelete: (challengeId: string) => void;
  onConfirmDelete: (challengeId: string) => void;
}

type ChallengeFilter = "all" | "open" | "resolved" | "archived";

const copy = challengesCopy.admin;
/** Longer texts start collapsed. "Vis mer" reveals the full text, so nothing is lost. */
const COLLAPSED_LENGTH = 280;

const STATUS_TONE: Record<AdminChallengeView["status"], StatusTone> = {
  open: "warning",
  resolved: "success",
  archived: "neutral",
};

/**
 * `/admin/teams/[teamId]`'s "Utfordringer" management section (docs/archive/features/anonymous-challenges/SPEC.md —
 * BR-30, BR-31, BR-35). Renders exactly what the server returned. Filtering and search run over that already-loaded list.
 * The filter is a presentation split only, never a privacy boundary. Lifecycle actions are rendered from each row's
 * server-provided status (never re-derived). The server remains the sole authorization and lifecycle authority.
 *
 * Never renders a submitter identity, a `uid`, or an email. No such field exists on `AdminChallengeView` (BR-11).
 * Open challenges are the default view. Resolved and archived challenges remain one click away.
 */
export function AdminChallengeList({
  state,
  actions,
  onResolve,
  onArchive,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: AdminChallengeListProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ChallengeFilter>("open");

  if (state.status === "loading") {
    return <LoadingState label={copy.loading} />;
  }

  if (state.status === "error") {
    return <Alert variant="error">{copy.error}</Alert>;
  }

  if (state.challenges.length === 0) {
    return <EmptyState>{copy.empty}</EmptyState>;
  }

  const challenges = state.challenges;
  const counts = {
    open: challenges.filter((challenge) => challenge.status === "open").length,
    resolved: challenges.filter((challenge) => challenge.status === "resolved").length,
    archived: challenges.filter((challenge) => challenge.status === "archived").length,
  };
  const matching = challenges.filter(
    (challenge) =>
      (filter === "all" || challenge.status === filter) && matchesSearchQuery(query, [challenge.text]),
  );
  const isSearching = query.trim() !== "";

  return (
    <div className="flex flex-col gap-4">
      <CountStrip
        items={[
          { label: copy.summaryLabels.open, value: counts.open },
          { label: copy.summaryLabels.resolved, value: counts.resolved },
          { label: copy.summaryLabels.archived, value: counts.archived },
        ]}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 sm:max-w-sm sm:flex-1">
          <TextField
            id="admin-challenge-search"
            type="search"
            label={copy.searchLabel}
            value={query}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <FilterChips<ChallengeFilter>
          label={copy.filterLabel}
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: copy.filterAll },
            { id: "open", label: copy.summaryLabels.open },
            { id: "resolved", label: copy.summaryLabels.resolved },
            { id: "archived", label: copy.summaryLabels.archived },
          ]}
        />
      </div>

      {matching.length === 0 ? (
        <EmptyState>
          {isSearching
            ? copy.noSearchMatches
            : filter === "open"
              ? copy.noOpen
              : filter === "resolved"
                ? copy.noResolved
                : filter === "archived"
                  ? copy.noArchived
                  : copy.empty}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border-subtle rounded-surface border border-border-subtle bg-surface shadow-card">
          {matching.map((challenge) => (
            <AdminChallengeRow
              key={challenge.challengeId}
              challenge={challenge}
              action={actions[challenge.challengeId] ?? { status: "idle" as const }}
              onResolve={() => onResolve(challenge.challengeId)}
              onArchive={() => onArchive(challenge.challengeId)}
              onRequestDelete={() => onRequestDelete(challenge.challengeId)}
              onCancelDelete={() => onCancelDelete(challenge.challengeId)}
              onConfirmDelete={() => onConfirmDelete(challenge.challengeId)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface AdminChallengeRowProps {
  challenge: AdminChallengeView;
  action: AdminChallengeRowActionState;
  onResolve: () => void;
  onArchive: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

/** Shortened name for accessible labels, so repeated controls stay distinguishable without reading the whole text. */
function shortLabel(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 40 ? `${trimmed.slice(0, 40).trimEnd()}…` : trimmed;
}

/**
 * One challenge row. The actions follow the server lifecycle (no reopen or unarchive exists):
 *   - `open`: Marker som løst as the primary action, and the menu holds Arkiver and Slett
 *   - `resolved`: the menu holds Arkiver and Slett
 *   - `archived`: the menu holds Slett only
 * Delete always goes through the inline confirmation.
 */
function AdminChallengeRow({
  challenge,
  action,
  onResolve,
  onArchive,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: AdminChallengeRowProps) {
  const [expanded, setExpanded] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const isPending = action.status === "pending";
  const isResolvePending = action.status === "pending" && action.action === "resolve";
  const isArchivePending = action.status === "pending" && action.action === "archive";
  const isDeletePending = action.status === "pending" && action.action === "delete";
  const confirming = action.status === "confirming_deletion";
  const label = shortLabel(challenge.text);
  const isLong = challenge.text.length > COLLAPSED_LENGTH;
  const shownText =
    isLong && !expanded ? `${challenge.text.slice(0, COLLAPSED_LENGTH).trimEnd()}…` : challenge.text;

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  const pendingLabel = isResolvePending
    ? copy.resolvingButton
    : isArchivePending
      ? copy.archivingButton
      : isDeletePending
        ? copy.deletingButton
        : null;

  const menuItems: ActionMenuItem[] = [
    ...(challenge.status !== "archived"
      ? [{ key: "archive", label: copy.archiveButton, onSelect: onArchive }]
      : []),
    { key: "delete", label: copy.deleteButton, destructive: true, onSelect: onRequestDelete },
  ];

  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="whitespace-pre-wrap break-words text-text-primary">{shownText}</p>
        {isLong && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((previous) => !previous)}
            className="mt-1 rounded-control text-sm font-medium text-primary hover:underline"
          >
            {expanded ? copy.showLess : copy.showMore}
          </button>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge tone={STATUS_TONE[challenge.status]}>{copy.statusLabels[challenge.status]}</StatusBadge>
          <span className="text-sm text-text-secondary">{formatSurveyDate(new Date(challenge.submittedAt))}</span>
        </div>
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
      </div>

      {!confirming && (
        <div className="flex flex-wrap items-center gap-2">
          {challenge.status === "open" && (
            <Button
              variant="primary"
              size="sm"
              disabled={isPending}
              pending={isResolvePending}
              aria-label={`${isResolvePending ? copy.resolvingButton : copy.resolveButton} – ${label}`}
              className="inline-flex items-center gap-2"
              onClick={onResolve}
            >
              <Icon icon={Check} size="inline" />
              {isResolvePending ? copy.resolvingButton : copy.resolveButton}
            </Button>
          )}
          <ActionsMenu label={`${copy.moreActions} – ${label}`} title={copy.moreActions} disabled={isPending} items={menuItems} />
        </div>
      )}

      {confirming && (
        <div className="flex flex-col gap-2 rounded-control border border-danger-text/40 bg-danger-subtle p-3">
          <p className="text-sm text-text-primary">{copy.deleteConfirmPrompt}</p>
          <div className="flex flex-wrap gap-2">
            <Button ref={cancelRef} variant="secondary" size="sm" onClick={onCancelDelete}>
              {copy.deleteCancelButton}
            </Button>
            <Button variant="destructive" size="sm" onClick={onConfirmDelete}>
              {copy.deleteConfirmButton}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

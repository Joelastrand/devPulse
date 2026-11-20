"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { TextField } from "../../../components/ui/TextField";
import { PageHeader } from "../../../components/ui/PageHeader";
import { ConversationsIllustration } from "../../../components/ui/illustrations/illustrations";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchConversationList, type ConversationListResponse } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";
import { CREATE_PANEL_ID, CREATE_TRIGGER_ID, CreateConversationForm } from "./CreateConversationForm";
import { ConversationsListSkeleton } from "./ConversationSkeletons";
import { OwnedConversationList, ParticipationList } from "./ConversationList";
import type { OwnerSummaryWire, ParticipationSummaryWire } from "../client/conversations-gateway";

/** Case-insensitive, whitespace-trimmed, Norwegian collation. The same rule on both sides of every comparison. */
function normalizeSearch(query: string): string {
  return query.trim().toLocaleLowerCase("nb");
}

/** Owned rows match on the conversation title and the colleague's display name, the two things the row already shows. */
function matchesOwned(conversation: OwnerSummaryWire, needle: string): boolean {
  if (needle === "") return true;
  return [conversation.title, conversation.participant.displayName ?? ""].some((value) => value.toLocaleLowerCase("nb").includes(needle));
}

/** Participations match on the title, when one is shown. A pending invitation carries no title, so it is never matched. */
function matchesParticipation(participation: ParticipationSummaryWire, needle: string): boolean {
  if (needle === "") return true;
  // A pending invitation is never searchable: its title is protected until acceptance, and a match would reveal it, even
  // if a title ever arrived in the list. Search only ever uses what an accepted entry shows.
  if (participation.state === "pending") return false;
  return (participation.title ?? "").toLocaleLowerCase("nb").includes(needle);
}

import { RecoveryRegion } from "./RecoveryRegion";

/** Filter chips over the existing sections (visual-redesign TASK-012). They only show or hide sections; no new read. */
const FILTERS = ["all", "open", "completed", "mine", "participating"] as const;
type ConversationFilter = (typeof FILTERS)[number];

type ViewState =
  | { phase: "loading" }
  | { phase: "signed_out" }
  | { phase: "load_error"; token: string; generation: number }
  | { phase: "ready"; data: ConversationListResponse; token: string; generation: number };

/**
 * The caller's own owner list and participation list (SPEC BR-33, BR-34, BR-44). One `GET /api/me/conversations` per auth
 * state through the browser gateway. The page owns its header and the one primary action, `Ny samtale`, which opens the create
 * panel. The action exists only once the list can be shown. The overview only links to a conversation's own page; it never
 * shows a detail beside the list.
 */
export function ConversationsPage() {
  const [state, setState] = useState<ViewState>({ phase: "loading" });
  const [createOpen, setCreateOpen] = useState(false);

  const { isCurrentGeneration } = useAuthGatedResource((token, generation) => {
    if (!token) {
      setState({ phase: "signed_out" });
      return;
    }
    setState({ phase: "loading" });
    void load(token, generation);
  });

  async function load(token: string, generation: number) {
    const result = await fetchConversationList(token);
    if (!isCurrentGeneration(generation)) return;
    if (result.status === "unauthenticated") {
      setState({ phase: "signed_out" });
    } else if (result.status !== "ok") {
      setState({ phase: "load_error", token, generation });
    } else {
      setState({ phase: "ready", data: result.response, token, generation });
    }
  }

  const createAction =
    state.phase === "ready" ? (
      <Button
        id={CREATE_TRIGGER_ID}
        type="button"
        variant="primary"
        aria-expanded={createOpen}
        aria-controls={createOpen ? CREATE_PANEL_ID : undefined}
        onClick={() => setCreateOpen((open) => !open)}
      >
        {conversationsCopy.createToggle}
      </Button>
    ) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={conversationsCopy.pageTitle} description={conversationsCopy.pageDescription} primaryAction={createAction} />
      <PageBody
        state={state}
        createOpen={createOpen}
        onCreateOpenChange={setCreateOpen}
        onSignedOut={() => setState({ phase: "signed_out" })}
        onRetry={(token, generation) => {
          setState({ phase: "loading" });
          void load(token, generation);
        }}
        onChanged={() => (state.phase === "ready" ? load(state.token, state.generation) : Promise.resolve())}
      />
    </div>
  );
}

interface PageBodyProps {
  state: ViewState;
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  onSignedOut: () => void;
  onRetry: (token: string, generation: number) => void;
  onChanged: () => Promise<void>;
}

function PageBody({ state, createOpen, onCreateOpenChange, onSignedOut, onRetry, onChanged }: PageBodyProps): ReactNode {
  if (state.phase === "loading") {
    return <ConversationsListSkeleton label={conversationsCopy.loading} />;
  }

  if (state.phase === "signed_out") {
    return (
      <p className="text-text-secondary">
        <Link href="/sign-in" className="font-medium text-text-primary underline underline-offset-2">
          {conversationsCopy.signInLink}
        </Link>{" "}
        {conversationsCopy.signInPrompt}
      </p>
    );
  }

  if (state.phase === "load_error") {
    const { token, generation } = state;
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="error">{conversationsCopy.loadError}</Alert>
        <Button variant="secondary" size="sm" onClick={() => onRetry(token, generation)}>
          {conversationsCopy.retryButton}
        </Button>
      </div>
    );
  }

  return (
    <ReadyView
      data={state.data}
      token={state.token}
      createOpen={createOpen}
      onCreateOpenChange={onCreateOpenChange}
      onUnauthenticated={onSignedOut}
      onChanged={onChanged}
    />
  );
}

interface ReadyViewProps {
  data: ConversationListResponse;
  token: string;
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  onUnauthenticated: () => void;
  onChanged: () => Promise<void>;
}

function ReadyView({ data, token, createOpen, onCreateOpenChange, onUnauthenticated, onChanged }: ReadyViewProps) {
  const summaries = data.owned.items.flatMap((item) => (item.kind === "summary" ? [item.conversation] : []));
  const recoveryItems = data.owned.items.flatMap((item) => (item.kind === "recovery" ? [item.item] : []));
  const participations = data.participating.items;
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [query, setQuery] = useState("");
  const needle = normalizeSearch(query);
  const searching = needle !== "";

  const showOpen = filter === "all" || filter === "open" || filter === "mine";
  const showCompleted = filter === "all" || filter === "completed" || filter === "mine";
  const showParticipating = filter === "all" || filter === "participating";
  // Recovery items carry only an id, so they cannot be matched by search. They are hidden while a search is active.
  const showRecovery = recoveryItems.length > 0 && filter !== "participating" && !searching;

  // The filter scope before search: what the chosen status filter would show. Counts are taken from this scope.
  const scopeOpen = summaries.filter((conversation) => conversation.status === "open");
  const scopeCompleted = summaries.filter((conversation) => conversation.status === "completed");
  const scopeTotal =
    (showOpen ? scopeOpen.length : 0) + (showCompleted ? scopeCompleted.length : 0) + (showParticipating ? participations.length : 0);

  // Search runs over the loaded list only: the title and the colleague name already in each row. Protected titles are not
  // searchable (a pending invitation has no title), and no field is read that the list does not already show.
  const openSummaries = scopeOpen.filter((conversation) => matchesOwned(conversation, needle));
  const completedSummaries = scopeCompleted.filter((conversation) => matchesOwned(conversation, needle));
  const invitations = participations.filter((participation) => participation.state === "pending" && matchesParticipation(participation, needle));
  const acceptedParticipations = participations.filter(
    (participation) => participation.state === "accepted" && matchesParticipation(participation, needle),
  );
  const visibleParticipations = [...invitations, ...acceptedParticipations];

  const empty = data.owned.items.length === 0 && participations.length === 0;
  const truncated = data.owned.truncated || data.participating.truncated;
  const visibleCount =
    (showOpen ? openSummaries.length : 0) +
    (showCompleted ? completedSummaries.length : 0) +
    (showParticipating ? visibleParticipations.length : 0) +
    (showRecovery ? recoveryItems.length : 0);
  const shownCount =
    (showOpen ? openSummaries.length : 0) + (showCompleted ? completedSummaries.length : 0) + (showParticipating ? visibleParticipations.length : 0);

  return (
    <div className="flex flex-col gap-6">
      {/* The privacy statement is the one place a manager's or colleague's visibility is stated on this page. */}
      <p className="max-w-prose text-sm text-text-secondary">{conversationsCopy.privacyNotice}</p>

      {/* Outside the empty/non-empty branch, so the panel stays in place while a create re-reads the list. */}
      <CreateConversationForm
        open={createOpen}
        onOpenChange={onCreateOpenChange}
        token={token}
        onUnauthenticated={onUnauthenticated}
        onChanged={onChanged}
      />

      {truncated && <Alert variant="info">{conversationsCopy.truncatedNotice}</Alert>}

      {!empty && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <TextField
                id="conversation-search"
                type="search"
                label={conversationsCopy.searchLabel}
                placeholder={conversationsCopy.searchPlaceholder}
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {searching && (
              <Button variant="secondary" size="sm" className="shrink-0" onClick={() => setQuery("")}>
                {conversationsCopy.resetSearch}
              </Button>
            )}
          </div>
          {/* Polite, nonintrusive count. It names the scope when the list is bounded, so a search never claims to cover more. */}
          <p className="text-help text-text-muted" aria-live="polite">
            {searching
              ? conversationsCopy.resultCountSearch(shownCount, scopeTotal)
              : conversationsCopy.resultCountAll(scopeTotal)}
            {searching && truncated && <> · {conversationsCopy.searchScopeNote}</>}
          </p>
        </div>
      )}

      {!empty && (
        <div role="group" aria-label={conversationsCopy.filters.label} className="flex flex-wrap gap-2">
          {FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
              className={`min-h-11 rounded-full border px-4 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                filter === option
                  ? "border-primary bg-primary-subtle font-semibold text-text-primary"
                  : "border-border-subtle bg-surface text-text-secondary hover:text-text-primary"
              }`}
            >
              {conversationsCopy.filters[option]}
            </button>
          ))}
        </div>
      )}

      {empty ? (
        <div className="flex flex-col items-start gap-4 rounded-surface border border-dashed border-border-subtle p-6">
          <ConversationsIllustration />
          <EmptyState>{conversationsCopy.empty}</EmptyState>
          <p className="text-sm text-text-secondary">{conversationsCopy.emptyHint}</p>
          {!createOpen && (
            <Button variant="primary" onClick={() => onCreateOpenChange(true)}>
              {conversationsCopy.emptyCreateButton}
            </Button>
          )}
        </div>
      ) : visibleCount === 0 ? (
        searching ? (
          <div className="flex flex-col items-start gap-3 rounded-surface border border-dashed border-border-subtle p-5">
            <p className="text-text-primary">{conversationsCopy.searchEmpty}</p>
            <Button variant="secondary" size="sm" onClick={() => setQuery("")}>
              {conversationsCopy.resetSearch}
            </Button>
          </div>
        ) : (
          <p className="text-text-secondary">{conversationsCopy.filterEmpty}</p>
        )
      ) : (
        <div className="flex min-w-0 flex-col gap-8">
          {/* A recovery-only owner list has no "you have no conversations" line: the recovery region below shows those items. */}
          {showOpen && (openSummaries.length > 0 || recoveryItems.length === 0) && (
            <section aria-labelledby="owned-heading" className="flex flex-col gap-3">
              <h2 id="owned-heading" className="text-section-title font-semibold text-text-primary">
                {conversationsCopy.ownedHeading}
              </h2>
              {openSummaries.length === 0 ? (
                <p className="text-text-secondary">{conversationsCopy.ownedEmpty}</p>
              ) : (
                <OwnedConversationList items={openSummaries} />
              )}
            </section>
          )}

          {showRecovery && (
            <RecoveryRegion items={recoveryItems} token={token} onUnauthenticated={onUnauthenticated} onChanged={onChanged} />
          )}

          {showCompleted && completedSummaries.length > 0 && (
            <section aria-labelledby="completed-heading" className="flex flex-col gap-3">
              <h2 id="completed-heading" className="text-section-title font-semibold text-text-primary">
                {conversationsCopy.completedHeading}
              </h2>
              <OwnedConversationList items={completedSummaries} />
            </section>
          )}

          {showParticipating && invitations.length > 0 && (
            <section aria-labelledby="invitations-heading" className="flex flex-col gap-3">
              <h2 id="invitations-heading" className="text-section-title font-semibold text-text-primary">
                {conversationsCopy.invitationsHeading}
              </h2>
              <ParticipationList items={invitations} />
            </section>
          )}

          {showParticipating && (
            <section aria-labelledby="participating-heading" className="flex flex-col gap-3">
              <h2 id="participating-heading" className="text-section-title font-semibold text-text-primary">
                {conversationsCopy.participatingHeading}
              </h2>
              {acceptedParticipations.length === 0 ? (
                <p className="text-text-secondary">{conversationsCopy.participatingEmpty}</p>
              ) : (
                <ParticipationList items={acceptedParticipations} />
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

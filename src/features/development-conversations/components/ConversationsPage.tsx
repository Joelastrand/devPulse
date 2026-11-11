"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ConversationsIllustration } from "../../../components/ui/illustrations/illustrations";
import { LoadingState } from "../../../components/ui/LoadingState";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchConversationList, type ConversationListResponse } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";
import { CreateConversationForm } from "./CreateConversationForm";
import { OwnedConversationList, ParticipationList } from "./ConversationList";

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
 * The caller's own owner list and participation list (SPEC BR-33, BR-34, BR-44). One `GET /api/me/conversations` per
 * auth state through the browser gateway. The server order and truncation flags are rendered as given. A successful
 * recovery delete re-reads this same `GET` instead of editing local state. The overview only links to a conversation's
 * own page; it never shows a detail beside the list.
 */
export function ConversationsPage() {
  const [state, setState] = useState<ViewState>({ phase: "loading" });

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

  if (state.phase === "loading") {
    return <LoadingState label={conversationsCopy.loading} />;
  }

  if (state.phase === "signed_out") {
    return (
      <p className="text-zinc-600 dark:text-zinc-400">
        <Link href="/sign-in" className="font-medium text-zinc-900 underline dark:text-zinc-50">
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
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setState({ phase: "loading" });
            void load(token, generation);
          }}
        >
          {conversationsCopy.retryButton}
        </Button>
      </div>
    );
  }

  const { data, token, generation } = state;
  return (
    <ReadyView
      data={data}
      token={token}
      onUnauthenticated={() => setState({ phase: "signed_out" })}
      onChanged={() => load(token, generation)}
    />
  );
}

interface ReadyViewProps {
  data: ConversationListResponse;
  token: string;
  onUnauthenticated: () => void;
  onChanged: () => Promise<void>;
}

function ReadyView({ data, token, onUnauthenticated, onChanged }: ReadyViewProps) {
  const summaries = data.owned.items.flatMap((item) => (item.kind === "summary" ? [item.conversation] : []));
  const recoveryItems = data.owned.items.flatMap((item) => (item.kind === "recovery" ? [item.item] : []));
  const participations = data.participating.items;
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const showOpen = filter === "all" || filter === "open" || filter === "mine";
  const showCompleted = filter === "all" || filter === "completed" || filter === "mine";
  const showParticipating = filter === "all" || filter === "participating";
  const showRecovery = recoveryItems.length > 0 && filter !== "participating";
  const openSummaries = summaries.filter((conversation) => conversation.status === "open");
  const completedSummaries = summaries.filter((conversation) => conversation.status === "completed");
  const invitations = participations.filter((participation) => participation.state === "pending");
  const acceptedParticipations = participations.filter((participation) => participation.state === "accepted");
  const empty = data.owned.items.length === 0 && participations.length === 0;
  const truncated = data.owned.truncated || data.participating.truncated;
  const visibleCount =
    (showOpen ? openSummaries.length : 0) +
    (showCompleted ? completedSummaries.length : 0) +
    (showParticipating ? participations.length : 0) +
    (showRecovery ? recoveryItems.length : 0);

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-prose text-sm text-text-secondary">{conversationsCopy.privacyNotice}</p>

      {/* Outside the empty/non-empty branch, so the form stays in place while a create re-reads the list. */}
      <CreateConversationForm token={token} onUnauthenticated={onUnauthenticated} onChanged={onChanged} />

      {truncated && <Alert variant="info">{conversationsCopy.truncatedNotice}</Alert>}

      {!empty && (
        <div role="group" aria-label={conversationsCopy.filters.label} className="flex flex-wrap gap-2">
          {FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
              className={`min-h-9 rounded-full border px-3 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                filter === option
                  ? "border-primary bg-primary-subtle font-medium text-text-primary"
                  : "border-border-subtle text-text-secondary hover:text-text-primary"
              }`}
            >
              {conversationsCopy.filters[option]}
            </button>
          ))}
        </div>
      )}

      {empty ? (
        <div className="flex flex-col items-start gap-3">
          <ConversationsIllustration />
          <EmptyState>{conversationsCopy.empty}</EmptyState>
        </div>
      ) : visibleCount === 0 ? (
        <p className="text-text-secondary">{conversationsCopy.filterEmpty}</p>
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
            <RecoveryRegion
              items={recoveryItems}
              token={token}
              onUnauthenticated={onUnauthenticated}
              onChanged={onChanged}
            />
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

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
import { ConversationDetail } from "./ConversationDetail";

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
 * recovery delete re-reads this same `GET` instead of editing local state.
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
  const wide = useWideConversationPane();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const showOpen = filter === "all" || filter === "open" || filter === "mine";
  const showCompleted = filter === "all" || filter === "completed" || filter === "mine";
  const showParticipating = filter === "all" || filter === "participating";
  const openSummaries = summaries.filter((conversation) => conversation.status === "open");
  const completedSummaries = summaries.filter((conversation) => conversation.status === "completed");
  const invitations = participations.filter((participation) => participation.state === "pending");
  const acceptedParticipations = participations.filter((participation) => participation.state === "accepted");
  const empty = data.owned.items.length === 0 && participations.length === 0;
  const truncated = data.owned.truncated || data.participating.truncated;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-zinc-700 dark:text-zinc-300">{conversationsCopy.privacyNotice}</p>

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
              className={`rounded-full border px-3 py-1 text-sm ${
                filter === option
                  ? "border-primary bg-primary-subtle text-text-primary"
                  : "border-border-subtle text-text-secondary"
              }`}
            >
              {conversationsCopy.filters[option]}
            </button>
          ))}
        </div>
      )}

      <div className={wide && !empty ? "grid items-start gap-6 xl:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]" : "flex flex-col gap-6"}>
      {/* BR-20: beside the detail, the list is its own scroll region; the page itself does not scroll horizontally. */}
      <div data-testid="conversation-list-column" className={wide && !empty ? "flex min-w-0 flex-col gap-6 xl:max-h-[calc(100dvh-10rem)] xl:overflow-y-auto xl:pr-1" : "flex min-w-0 flex-col gap-6"}>
      {empty ? (
        <div className="flex flex-col items-start gap-3">
          <ConversationsIllustration />
          <EmptyState>{conversationsCopy.empty}</EmptyState>
        </div>
      ) : (
        <>
          {/* A recovery-only owner list has no "you have no conversations" line: the recovery region below shows those items. */}
          {showOpen && (openSummaries.length > 0 || recoveryItems.length === 0) && (
            <section aria-labelledby="owned-heading" className="flex flex-col gap-3">
              <h2 id="owned-heading" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {conversationsCopy.ownedHeading}
              </h2>
              {openSummaries.length === 0 ? (
                <p className="text-zinc-600 dark:text-zinc-400">{conversationsCopy.ownedEmpty}</p>
              ) : (
                <OwnedConversationList items={openSummaries} selectable={wide} selectedId={selectedId} onSelect={setSelectedId} />
              )}
            </section>
          )}

          {recoveryItems.length > 0 && filter !== "participating" && (
            <RecoveryRegion
              items={recoveryItems}
              token={token}
              onUnauthenticated={onUnauthenticated}
              onChanged={onChanged}
            />
          )}

          {showCompleted && completedSummaries.length > 0 && (
            <section aria-labelledby="completed-heading" className="flex flex-col gap-3">
              <h2 id="completed-heading" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {conversationsCopy.completedHeading}
              </h2>
              <OwnedConversationList items={completedSummaries} selectable={wide} selectedId={selectedId} onSelect={setSelectedId} />
            </section>
          )}

          {showParticipating && invitations.length > 0 && (
            <section aria-labelledby="invitations-heading" className="flex flex-col gap-3">
              <h2 id="invitations-heading" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {conversationsCopy.invitationsHeading}
              </h2>
              <ParticipationList items={invitations} />
            </section>
          )}

          {showParticipating && <section aria-labelledby="participating-heading" className="flex flex-col gap-3">
            <h2 id="participating-heading" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {conversationsCopy.participatingHeading}
            </h2>
            {acceptedParticipations.length === 0 ? (
              <p className="text-zinc-600 dark:text-zinc-400">{conversationsCopy.participatingEmpty}</p>
            ) : (
              <ParticipationList items={acceptedParticipations} />
            )}
          </section>}
        </>
      )}
      </div>
      {wide && !empty && (
        <aside aria-label={conversationsCopy.selectedPaneLabel} data-testid="conversation-detail-pane" className="min-w-0 self-start">
          {selectedId !== null ? (
            <ConversationDetail key={selectedId} conversationId={selectedId} />
          ) : (
            <p className="text-help text-text-secondary">{conversationsCopy.selectPrompt}</p>
          )}
        </aside>
      )}
      </div>
    </div>
  );
}

/** True from the xl breakpoint (1280 px) up, where the selected conversation sits beside the list. False without matchMedia. */
export function useWideConversationPane(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(min-width: 1280px)")
        : null;
    if (!query) return;
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

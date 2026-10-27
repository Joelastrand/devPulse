"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchConversationList, type ConversationListResponse } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";
import { CreateConversationForm } from "./CreateConversationForm";
import { OwnedConversationList, ParticipationList } from "./ConversationList";
import { RecoveryRegion } from "./RecoveryRegion";

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
  const empty = data.owned.items.length === 0 && participations.length === 0;
  const truncated = data.owned.truncated || data.participating.truncated;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-zinc-700 dark:text-zinc-300">{conversationsCopy.privacyNotice}</p>

      {/* Outside the empty/non-empty branch, so the form stays in place while a create re-reads the list. */}
      <CreateConversationForm token={token} onUnauthenticated={onUnauthenticated} onChanged={onChanged} />

      {truncated && <Alert variant="info">{conversationsCopy.truncatedNotice}</Alert>}

      {empty ? (
        <EmptyState>{conversationsCopy.empty}</EmptyState>
      ) : (
        <>
          {/* A recovery-only owner list has no "you have no conversations" line: the recovery region below shows those items. */}
          {(summaries.length > 0 || recoveryItems.length === 0) && (
            <section aria-labelledby="owned-heading" className="flex flex-col gap-3">
              <h2 id="owned-heading" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {conversationsCopy.ownedHeading}
              </h2>
              {summaries.length === 0 ? (
                <p className="text-zinc-600 dark:text-zinc-400">{conversationsCopy.ownedEmpty}</p>
              ) : (
                <OwnedConversationList items={summaries} />
              )}
            </section>
          )}

          {recoveryItems.length > 0 && (
            <RecoveryRegion
              items={recoveryItems}
              token={token}
              onUnauthenticated={onUnauthenticated}
              onChanged={onChanged}
            />
          )}

          <section aria-labelledby="participating-heading" className="flex flex-col gap-3">
            <h2 id="participating-heading" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {conversationsCopy.participatingHeading}
            </h2>
            {participations.length === 0 ? (
              <p className="text-zinc-600 dark:text-zinc-400">{conversationsCopy.participatingEmpty}</p>
            ) : (
              <ParticipationList items={participations} />
            )}
          </section>
        </>
      )}
    </div>
  );
}

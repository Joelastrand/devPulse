"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { LoadingState } from "../../../components/ui/LoadingState";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import {
  acceptInvitation,
  endParticipation,
  fetchConversation,
  type ConversationView,
  type FetchConversationResult,
  type OwnerConversationWire,
  type ParticipantConversationWire,
  type PendingInvitationWire,
} from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";
import { OwnerConversationEditor } from "./OwnerConversationEditor";
import { ParticipantConversation } from "./ParticipantConversation";
import { PendingInvitation } from "./PendingInvitation";
import { acceptOutcome, endOutcome, type ParticipationOutcome } from "./participation-outcome";

type ViewState =
  | { phase: "loading" }
  | { phase: "signed_out" }
  | { phase: "not_found" }
  | { phase: "load_error"; token: string; generation: number }
  | { phase: "owner"; conversation: OwnerConversationWire; token: string; generation: number; refreshFailed: boolean }
  | {
      phase: "participant";
      conversation: ParticipantConversationWire;
      token: string;
      generation: number;
      notice: string | undefined;
      refreshFailed: boolean;
    }
  | { phase: "pending"; invitation: PendingInvitationWire; token: string; generation: number; notice: string | undefined }
  /** A decline or a leave the server confirmed. No content is read after it. */
  | { phase: "ended"; message: string }
  /** An action whose result could not be confirmed, and whose re-read also failed. The action is never sent again. */
  | { phase: "unconfirmed"; message: string; token: string; generation: number };

/** Notices a re-read after an action may show. Each one states only what that outcome and the re-read proved. */
interface AfterAction {
  participant?: string;
  pending?: string;
  unreadable: string;
}

/** The view the server chose, with the notice this read may show. Owner views carry no notice (SPEC BR-35). */
function viewFor(view: ConversationView, token: string, generation: number, notice?: string): ViewState {
  switch (view.kind) {
    case "owner":
      return { phase: "owner", conversation: view.conversation, token, generation, refreshFailed: false };
    case "participant":
      return { phase: "participant", conversation: view.conversation, token, generation, notice, refreshFailed: false };
    case "pending":
      return { phase: "pending", invitation: view.invitation, token, generation, notice };
  }
}

/**
 * Next state for one detail read. The server chooses the view, and the page renders that kind only. A failed re-read while
 * an owner or participant view is shown keeps the view, so drafts are not lost. A failed first read has nothing to show.
 */
function nextState(previous: ViewState, result: FetchConversationResult, token: string, generation: number): ViewState {
  if (result.status === "unauthenticated") return { phase: "signed_out" };
  if (result.status === "ok") return viewFor(result.view, token, generation);
  if (result.error === "conversation_not_found") return { phase: "not_found" };
  if (previous.phase === "owner" || previous.phase === "participant") return { ...previous, token, generation, refreshFailed: true };
  return { phase: "load_error", token, generation };
}

/**
 * The view after a participation action and its re-read (SPEC BR-15, BR-17, BR-35; TASK-030). A pending view is shown
 * only when the caller allows it, so a confirmed accept never shows the pending view as a plain result.
 */
function viewAfterAction(result: FetchConversationResult, token: string, generation: number, copy: AfterAction): ViewState {
  if (result.status === "unauthenticated") return { phase: "signed_out" };
  if (result.status === "ok") {
    if (result.view.kind === "owner") return viewFor(result.view, token, generation);
    if (result.view.kind === "participant") return viewFor(result.view, token, generation, copy.participant);
    if (copy.pending !== undefined) return viewFor(result.view, token, generation, copy.pending);
  } else if (result.error === "conversation_not_found") {
    return { phase: "not_found" };
  }
  return { phase: "unconfirmed", message: copy.unreadable, token, generation };
}

/** A refused or signed-out outcome needs no re-read. Anything else is read again once. */
function decidedWithoutRead(outcome: ParticipationOutcome): ViewState | undefined {
  if (outcome.kind === "signed_out") return { phase: "signed_out" };
  if (outcome.kind === "not_found") return { phase: "not_found" };
  return undefined;
}

/** A view that keeps the owner's or participant's typed draft through a token refresh. */
function keepsDraft(state: ViewState): state is Extract<ViewState, { phase: "owner" | "participant" }> {
  return state.phase === "owner" || state.phase === "participant";
}

/**
 * The conversation page (SPEC BR-35; TASK-028 owner editor, TASK-030 participant views). One `GET` per auth state through
 * the browser gateway, and a silent re-read after each write, so an editor stays mounted. The server's `kind` chooses the
 * view and nothing else does. Forbidden and absent conversations share one copy.
 */
export function ConversationDetail({ conversationId }: { conversationId: string }) {
  const [state, setState] = useState<ViewState>({ phase: "loading" });

  const { isCurrentGeneration } = useAuthGatedResource((token, generation) => {
    if (!token) {
      setState({ phase: "signed_out" });
      return;
    }
    // A token refresh while a draft is on screen re-reads in place, so the draft is kept.
    setState((previous) => (keepsDraft(previous) ? previous : { phase: "loading" }));
    void load(token, generation);
  }, [conversationId]);

  async function load(token: string, generation: number) {
    const result = await fetchConversation(token, conversationId);
    if (!isCurrentGeneration(generation)) return;
    setState((previous) => nextState(previous, result, token, generation));
  }

  /** Re-reads once after an action. The action is never sent again from here. */
  async function reread(token: string, generation: number, copy: AfterAction) {
    const result = await fetchConversation(token, conversationId);
    if (!isCurrentGeneration(generation)) return;
    setState(viewAfterAction(result, token, generation, copy));
  }

  function commit(generation: number, next: ViewState) {
    if (isCurrentGeneration(generation)) setState(next);
  }

  // Stable, because the goal selector's and the participant views' effects depend on it.
  const onUnauthenticated = useCallback(() => setState({ phase: "signed_out" }), []);

  async function refresh() {
    if (!keepsDraft(state)) return;
    await load(state.token, state.generation);
  }

  function retry(token: string, generation: number) {
    setState({ phase: "loading" });
    void load(token, generation);
  }

  /** One accept request. The server's answer, or the re-read after an unknown one, decides the next view. */
  async function acceptPending() {
    if (state.phase !== "pending") return;
    const { token, generation } = state;
    const outcome = acceptOutcome(await acceptInvitation(token, conversationId));
    const immediate = decidedWithoutRead(outcome);
    if (immediate) return commit(generation, immediate);
    await reread(
      token,
      generation,
      outcome.kind === "confirmed"
        ? { participant: conversationsCopy.acceptedNotice, pending: conversationsCopy.participationUnconfirmed, unreadable: conversationsCopy.acceptedUnread }
        : {
            participant: conversationsCopy.acceptedNotice,
            pending: conversationsCopy.acceptNotConfirmedPending,
            unreadable: conversationsCopy.participationUnconfirmed,
          },
    );
  }

  /** One decline request. A confirmed decline shows the ended notice and reads no content. */
  async function declinePending() {
    if (state.phase !== "pending") return;
    const { token, generation } = state;
    const outcome = endOutcome(await endParticipation(token, conversationId));
    if (outcome.kind === "confirmed") return commit(generation, { phase: "ended", message: conversationsCopy.declinedNotice });
    const immediate = decidedWithoutRead(outcome);
    if (immediate) return commit(generation, immediate);
    await reread(token, generation, {
      participant: conversationsCopy.participationStillActive,
      pending: conversationsCopy.declineNotConfirmedPending,
      unreadable: conversationsCopy.participationUnconfirmed,
    });
  }

  /** One leave request. A confirmed leave shows the ended notice and reads no content. */
  async function leaveParticipation() {
    if (state.phase !== "participant") return;
    const { token, generation } = state;
    const outcome = endOutcome(await endParticipation(token, conversationId));
    if (outcome.kind === "confirmed") return commit(generation, { phase: "ended", message: conversationsCopy.leftNotice });
    const immediate = decidedWithoutRead(outcome);
    if (immediate) return commit(generation, immediate);
    await reread(token, generation, {
      participant: conversationsCopy.participationStillActive,
      unreadable: conversationsCopy.participationUnconfirmed,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <p>
        <Link href="/me/conversations" className="text-sm font-medium text-zinc-900 underline dark:text-zinc-50">
          {conversationsCopy.backToList}
        </Link>
      </p>
      <DetailBody
        state={state}
        actions={{
          onUnauthenticated,
          onRetry: retry,
          onChanged: refresh,
          onAccept: acceptPending,
          onDecline: declinePending,
          onLeave: leaveParticipation,
        }}
      />
    </div>
  );
}

interface DetailActions {
  onUnauthenticated: () => void;
  onRetry: (token: string, generation: number) => void;
  onChanged: () => Promise<void>;
  onAccept: () => Promise<void>;
  onDecline: () => Promise<void>;
  onLeave: () => Promise<void>;
}

function DetailBody({ state, actions }: { state: ViewState; actions: DetailActions }) {
  switch (state.phase) {
    case "loading":
      return <LoadingState label={conversationsCopy.detailLoading} />;
    case "signed_out":
      return (
        <p className="text-zinc-600 dark:text-zinc-400">
          <Link href="/sign-in" className="font-medium text-zinc-900 underline dark:text-zinc-50">
            {conversationsCopy.signInLink}
          </Link>{" "}
          {conversationsCopy.signInPrompt}
        </p>
      );
    case "not_found":
      return <Alert variant="info">{conversationsCopy.detailNotFound}</Alert>;
    case "load_error":
      return (
        <div className="flex flex-col items-start gap-3">
          <Alert variant="error">{conversationsCopy.detailLoadError}</Alert>
          <Button variant="secondary" size="sm" onClick={() => actions.onRetry(state.token, state.generation)}>
            {conversationsCopy.retryButton}
          </Button>
        </div>
      );
    case "owner":
      return (
        <div className="flex flex-col gap-6">
          {state.refreshFailed && <Alert variant="error">{conversationsCopy.refreshFailed}</Alert>}
          <OwnerConversationEditor
            conversation={state.conversation}
            token={state.token}
            onUnauthenticated={actions.onUnauthenticated}
            onChanged={actions.onChanged}
          />
        </div>
      );
    case "participant":
      return (
        <ParticipantConversation
          conversation={state.conversation}
          token={state.token}
          notice={state.notice}
          refreshFailed={state.refreshFailed}
          onLeave={actions.onLeave}
          onChanged={actions.onChanged}
          onUnauthenticated={actions.onUnauthenticated}
        />
      );
    case "pending":
      return (
        <PendingInvitation invitation={state.invitation} notice={state.notice} onAccept={actions.onAccept} onDecline={actions.onDecline} />
      );
    case "ended":
      return <FocusedNotice message={state.message} />;
    case "unconfirmed":
      return (
        <div className="flex flex-col gap-3">
          <FocusedNotice message={state.message} />
          <div>
            <Button variant="secondary" size="sm" onClick={() => actions.onRetry(state.token, state.generation)}>
              {conversationsCopy.reloadConversation}
            </Button>
          </div>
        </div>
      );
  }
}

/** A result message that takes focus when it appears, so the outcome is announced once. */
function FocusedNotice({ message }: { message: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div ref={ref} tabIndex={-1} className="outline-none">
      <Alert variant="info">{message}</Alert>
    </div>
  );
}

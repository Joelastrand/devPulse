"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { formatSurveyDate } from "../../results/domain/format-survey-date";
import { fetchOwnAdminStatus } from "../../teams/client/own-admin-status-gateway";
import {
  deleteReply,
  deleteThread,
  fetchThreadDetail,
  type ReplyView,
  type ThreadDetailView,
} from "../client/forum-gateway";
import { forumCopy } from "../copy";
import { DeleteConfirmation, type DeleteActionState } from "./DeleteConfirmation";
import { ReplyForm } from "./ReplyForm";

type LoadResult =
  | { status: "not_found" }
  | { status: "error" }
  | { status: "loaded"; thread: ThreadDetailView; replies: ReplyView[]; isAdmin: boolean };

/**
 * A `forbidden`/`not_found` result is rendered identically (BR-16) — never a
 * distinguishing message that would let a caller tell a cross-team, deleted,
 * or never-existed `threadId` apart from one they merely lack access to. The
 * caller's own `isAdmin` status is read once alongside the thread itself,
 * via the existing, unchanged `GET /api/me` (mirrors `SiteHeader`'s reuse);
 * a read failure there fails closed to `isAdmin: false`, never granting a
 * delete affordance on an inconclusive read.
 */
async function loadThreadDetail(idToken: string, teamId: string, threadId: string): Promise<LoadResult> {
  const [detail, adminStatus] = await Promise.all([
    fetchThreadDetail(idToken, teamId, threadId),
    fetchOwnAdminStatus(idToken),
  ]);

  if (detail.status === "ok") {
    return {
      status: "loaded",
      thread: detail.thread,
      replies: detail.replies,
      isAdmin: adminStatus.ok && adminStatus.isAdmin,
    };
  }
  if (detail.status === "not_found" || detail.status === "forbidden") {
    return { status: "not_found" };
  }
  return { status: "error" };
}

type ViewState =
  | { phase: "loading" }
  | { phase: "signed_out" }
  | { phase: "loaded"; token: string; generation: number; result: LoadResult };

/**
 * `/teams/[teamId]/forum/[threadId]` (docs/features/team-forum/SPEC.md —
 * TASK-005, BR-16, BR-38 through BR-40, BR-46). Mirrors `TeamDetail`'s
 * client-side auth-state and generation-guard pattern via the shared
 * `useAuthGatedResource` hook, with both `teamId` and `threadId` as extra
 * reset dependencies — navigating between two threads (or two teams) tears
 * down the previous subscription before starting a fresh load, so a slow
 * response for one thread can never render on another's page.
 *
 * Renders exactly what `getThreadWithReplies` returned — no deleted-content
 * filtering, tombstone detection, or capacity logic of its own
 * (`.claude/rules/security.md`); a tombstoned reply is shown only through
 * its content-free placeholder, and a deleted/cross-team/never-existed
 * thread is shown only through the identical generic "not found" state.
 */
export function ThreadDetail({ teamId, threadId }: { teamId: string; threadId: string }) {
  const router = useRouter();
  const [state, setState] = useState<ViewState>({ phase: "loading" });
  const [deleteThreadState, setDeleteThreadState] = useState<DeleteActionState>({ status: "idle" });
  const [replyDeleteState, setReplyDeleteState] = useState<Record<string, DeleteActionState>>({});

  const { isCurrentGeneration } = useAuthGatedResource(
    (token, generation) => {
      setDeleteThreadState({ status: "idle" });
      setReplyDeleteState({});

      if (!token) {
        setState({ phase: "signed_out" });
        return;
      }

      setState({ phase: "loading" });
      loadForGeneration(token, generation);
    },
    [teamId, threadId],
  );

  async function loadForGeneration(token: string, generation: number) {
    const result = await loadThreadDetail(token, teamId, threadId);
    if (isCurrentGeneration(generation)) {
      setState({ phase: "loaded", token, generation, result });
    }
  }

  async function handleDeleteThread(token: string, generation: number) {
    setDeleteThreadState({ status: "pending" });
    const result = await deleteThread(token, teamId, threadId);

    if (!isCurrentGeneration(generation)) {
      return;
    }

    if (!result.ok) {
      setDeleteThreadState({ status: "error", message: forumCopy.deleteThread.error });
      return;
    }

    router.push(`/teams/${encodeURIComponent(teamId)}`);
  }

  /**
   * Tolerates a retry landing on an already-tombstoned reply exactly like a
   * first-time delete (BR-27, revised) — `deleteReply` returns `ok: true`
   * for both, so this handler never distinguishes them; no author identity
   * is ever reconstructed or retained across a retry.
   */
  async function handleDeleteReply(token: string, generation: number, replyId: string) {
    setReplyDeleteState((previous) => ({ ...previous, [replyId]: { status: "pending" } }));
    const result = await deleteReply(token, teamId, threadId, replyId);

    if (!isCurrentGeneration(generation)) {
      return;
    }

    if (!result.ok) {
      setReplyDeleteState((previous) => ({
        ...previous,
        [replyId]: { status: "error", message: forumCopy.deleteReply.error },
      }));
      return;
    }

    setReplyDeleteState((previous) => ({ ...previous, [replyId]: { status: "idle" } }));
    await loadForGeneration(token, generation);
  }

  if (state.phase === "loading") {
    return <LoadingState label={forumCopy.detail.loading} />;
  }

  if (state.phase === "signed_out") {
    return (
      <p className="text-zinc-600 dark:text-zinc-400">
        <Link href="/sign-in" className="font-medium text-zinc-900 underline dark:text-zinc-50">
          {forumCopy.detail.signInLink}
        </Link>{" "}
        {forumCopy.detail.signedOutMessage}
      </p>
    );
  }

  const { result, token, generation } = state;

  if (result.status === "not_found") {
    return <Alert variant="info">{forumCopy.detail.notFound}</Alert>;
  }

  if (result.status === "error") {
    return <Alert variant="error">{forumCopy.detail.error}</Alert>;
  }

  const { thread, replies, isAdmin } = result;
  const canDeleteThread = thread.isOwnThread || isAdmin;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={thread.title}
        description={`${forumCopy.authorTagLabel(thread.authorTag)} · ${formatSurveyDate(new Date(thread.createdAt))}`}
      />

      <Card as="section" variant="bordered" padding="md" aria-label={thread.title}>
        <p className="whitespace-pre-wrap break-words text-zinc-900 dark:text-zinc-50">{thread.body}</p>
      </Card>

      {canDeleteThread && (
        <DeleteConfirmation
          state={deleteThreadState}
          deleteLabel={forumCopy.deleteThread.button}
          deletingLabel={forumCopy.deleteThread.deleting}
          confirmPrompt={forumCopy.deleteThread.confirmPrompt}
          confirmLabel={forumCopy.deleteThread.confirmButton}
          cancelLabel={forumCopy.deleteThread.cancelButton}
          onRequestDelete={() => setDeleteThreadState({ status: "confirming" })}
          onCancelDelete={() => setDeleteThreadState({ status: "idle" })}
          onConfirmDelete={() => handleDeleteThread(token, generation)}
        />
      )}

      <section aria-labelledby="forum-replies-heading" className="flex flex-col gap-4">
        <h2 id="forum-replies-heading" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {forumCopy.detail.repliesHeading}
        </h2>

        {replies.length === 0 ? (
          <EmptyState>{forumCopy.detail.noReplies}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {replies.map((reply) => (
              <ReplyRow
                key={reply.replyId}
                reply={reply}
                isAdmin={isAdmin}
                deleteState={replyDeleteState[reply.replyId] ?? { status: "idle" }}
                onRequestDelete={() =>
                  setReplyDeleteState((previous) => ({ ...previous, [reply.replyId]: { status: "confirming" } }))
                }
                onCancelDelete={() =>
                  setReplyDeleteState((previous) => ({ ...previous, [reply.replyId]: { status: "idle" } }))
                }
                onConfirmDelete={() => handleDeleteReply(token, generation, reply.replyId)}
              />
            ))}
          </ul>
        )}

        <ReplyForm
          idToken={token}
          teamId={teamId}
          threadId={threadId}
          onSubmitted={() => loadForGeneration(token, generation)}
        />
      </section>
    </div>
  );
}

function ReplyRow({
  reply,
  isAdmin,
  deleteState,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  reply: ReplyView;
  isAdmin: boolean;
  deleteState: DeleteActionState;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  if (reply.isDeleted) {
    return (
      <Card as="li" variant="bordered" padding="sm">
        <p className="text-sm italic text-zinc-600 dark:text-zinc-400">{forumCopy.detail.deletedReplyPlaceholder}</p>
      </Card>
    );
  }

  const canDelete = reply.isOwnReply || isAdmin;
  const postedAt = formatSurveyDate(new Date(reply.createdAt));

  return (
    <Card as="li" variant="bordered" padding="sm" className="flex flex-col gap-2">
      <p className="whitespace-pre-wrap break-words text-zinc-900 dark:text-zinc-50">{reply.body}</p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {forumCopy.authorTagLabel(reply.authorTag)} · {postedAt}
      </p>
      {canDelete && (
        <DeleteConfirmation
          state={deleteState}
          deleteLabel={forumCopy.deleteReply.button}
          deletingLabel={forumCopy.deleteReply.deleting}
          confirmPrompt={forumCopy.deleteReply.confirmPrompt}
          confirmLabel={forumCopy.deleteReply.confirmButton}
          cancelLabel={forumCopy.deleteReply.cancelButton}
          context={postedAt}
          onRequestDelete={onRequestDelete}
          onCancelDelete={onCancelDelete}
          onConfirmDelete={onConfirmDelete}
        />
      )}
    </Card>
  );
}

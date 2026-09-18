import Link from "next/link";
import { Alert } from "../../../components/ui/Alert";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { formatSurveyDate } from "../../results/domain/format-survey-date";
import type { ThreadSummaryView } from "../client/forum-gateway";
import { forumCopy } from "../copy";

export type ThreadListState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; threads: ThreadSummaryView[] };

/**
 * `/teams/[teamId]`'s read-only forum thread list (docs/features/
 * team-forum/SPEC.md — BR-15, BR-37). Renders **exactly** what
 * `listTeamThreads` (via `fetchTeamThreads`'s shape validation) returned —
 * already newest-first, never re-sorted or filtered here. A hard-deleted
 * thread can never reach this component at all, since `listTeamThreads`'s
 * underlying query cannot return a document that no longer exists
 * (`.claude/rules/security.md` — no UI-side filtering stands in for that
 * server-side guarantee).
 */
export function ThreadList({ teamId, state }: { teamId: string; state: ThreadListState }) {
  if (state.status === "loading") {
    return <LoadingState label={forumCopy.section.loading} />;
  }

  if (state.status === "error") {
    return <Alert variant="error">{forumCopy.section.error}</Alert>;
  }

  if (state.threads.length === 0) {
    return <EmptyState>{forumCopy.section.empty}</EmptyState>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {state.threads.map((thread) => (
        <ThreadRow key={thread.threadId} teamId={teamId} thread={thread} />
      ))}
    </ul>
  );
}

function ThreadRow({ teamId, thread }: { teamId: string; thread: ThreadSummaryView }) {
  return (
    <Card as="li" variant="bordered" padding="sm" className="flex flex-col gap-1">
      <Link
        href={`/teams/${encodeURIComponent(teamId)}/forum/${encodeURIComponent(thread.threadId)}`}
        className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
      >
        {thread.title}
      </Link>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {forumCopy.authorTagLabel(thread.authorTag)} · {formatSurveyDate(new Date(thread.createdAt))}
      </p>
    </Card>
  );
}

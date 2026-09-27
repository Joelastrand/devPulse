import { notFound } from "next/navigation";
import { PageShell } from "../../../../../src/components/ui/PageShell";
import { ThreadDetail } from "../../../../../src/features/forum/components/ThreadDetail";
import { isForumEnabled } from "../../../../../src/features/forum/server/is-forum-enabled";

/**
 * Gated on `isForumEnabled()` (docs/features/team-forum/SPEC.md — "Feature
 * flag"): while disabled, this resolves to the same `notFound()` outcome as
 * a genuinely nonexistent thread — `ThreadDetail` is never rendered, so no
 * Forum client code mounts and no Forum data fetch starts. This is a
 * product/UI availability gate only; the underlying `/api/teams/[teamId]/
 * forum/...` routes and their authorization are unaffected and remain
 * reachable directly.
 */
export default async function ForumThreadDetailPage({
  params,
}: {
  params: Promise<{ teamId: string; threadId: string }>;
}) {
  if (!isForumEnabled()) {
    notFound();
  }

  const { teamId, threadId } = await params;

  return (
    <PageShell width="3xl">
      <ThreadDetail teamId={teamId} threadId={threadId} />
    </PageShell>
  );
}

import { PageShell } from "../../../../../src/components/ui/PageShell";
import { ThreadDetail } from "../../../../../src/features/forum/components/ThreadDetail";

export default async function ForumThreadDetailPage({
  params,
}: {
  params: Promise<{ teamId: string; threadId: string }>;
}) {
  const { teamId, threadId } = await params;

  return (
    <PageShell width="3xl">
      <ThreadDetail teamId={teamId} threadId={threadId} />
    </PageShell>
  );
}

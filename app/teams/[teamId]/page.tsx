import { PageShell } from "../../../src/components/ui/PageShell";
import { TeamDetail } from "../../../src/features/teams/components/TeamDetail";
import { isForumEnabled } from "../../../src/features/forum/server/is-forum-enabled";

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;

  return (
    <PageShell width="3xl">
      <TeamDetail teamId={teamId} forumEnabled={isForumEnabled()} />
    </PageShell>
  );
}

import { PageShell } from "../../../../../src/components/ui/PageShell";
import { PublicTeamPage } from "../../../../../src/features/teams/components/PublicTeamPage";

export default async function PublicTeamRoute({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;

  return (
    <PageShell width="3xl">
      <PublicTeamPage teamId={teamId} />
    </PageShell>
  );
}

import { PageShell } from "../../../../src/components/ui/PageShell";
import { AdminTeamDetail } from "../../../../src/features/teams/components/AdminTeamDetail";

export default async function AdminTeamDetailPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;

  return (
    <PageShell width="wide">
      <AdminTeamDetail teamId={teamId} />
    </PageShell>
  );
}

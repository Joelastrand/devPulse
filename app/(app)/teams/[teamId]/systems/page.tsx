import { PageShell } from "../../../../../src/components/ui/PageShell";
import { TeamSystemsPage } from "../../../../../src/features/team-systems/components/TeamSystemsPage";

export default async function TeamSystemsRoutePage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;

  return (
    <PageShell width="wide">
      <TeamSystemsPage teamId={teamId} />
    </PageShell>
  );
}

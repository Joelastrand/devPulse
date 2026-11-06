import { PageShell } from "../../../../../src/components/ui/PageShell";
import { TeamProjectRoadmap } from "../../../../../src/features/team-projects/components/TeamProjectRoadmap";

export default async function TeamRoadmapPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;

  return (
    <PageShell width="3xl">
      <TeamProjectRoadmap teamId={teamId} />
    </PageShell>
  );
}

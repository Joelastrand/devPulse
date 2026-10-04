import { PageShell } from "../../../../src/components/ui/PageShell";
import { RoadmapPage } from "../../../../src/features/roadmap/components/RoadmapPage";

export default async function TeamRoadmapPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;

  return (
    <PageShell width="3xl">
      <RoadmapPage teamId={teamId} />
    </PageShell>
  );
}

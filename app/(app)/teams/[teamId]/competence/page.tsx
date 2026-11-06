import { PageShell } from "../../../../../src/components/ui/PageShell";
import { TeamCompetenceCoverage } from "../../../../../src/features/team-skills/components/TeamCompetenceCoverage";
import { TeamPageHeader } from "../../../../../src/features/teams/components/TeamPageHeader";

/**
 * `/teams/[teamId]/competence` (BR-25–BR-27, TASK-011). The categorical coverage view is client-loaded through the
 * existing authorized coverage gateway; the server page only renders the shared header and the view.
 */
export default async function TeamCompetenceCoveragePage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;

  return (
    <PageShell width="3xl">
      <TeamPageHeader teamId={teamId} />
      <div className="mt-6">
        <TeamCompetenceCoverage teamId={teamId} />
      </div>
    </PageShell>
  );
}

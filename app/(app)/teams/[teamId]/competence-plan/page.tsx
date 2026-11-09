import { PageShell } from "../../../../../src/components/ui/PageShell";
import { TeamCompetenceNeedsSection } from "../../../../../src/features/teams/components/TeamSubpageSections";
import { TeamPageHeader } from "../../../../../src/features/teams/components/TeamPageHeader";
import { CompetencePlanSection } from "../../../../../src/features/team-competence-plan/components/CompetencePlanSection";

/**
 * `/teams/[teamId]/competence-plan` (BR-15–BR-17). The shared team header is server-rendered; the plan itself loads
 * through the authorized API on the client (TASK-006).
 */
export default async function TeamCompetencePlanPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;

  return (
    <PageShell width="3xl">
      <TeamPageHeader teamId={teamId} />
      <div className="mt-6">
        <CompetencePlanSection teamId={teamId} />
      </div>
      <div className="mt-10">
        <TeamCompetenceNeedsSection teamId={teamId} />
      </div>
    </PageShell>
  );
}

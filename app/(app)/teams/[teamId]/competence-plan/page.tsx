import { PageShell } from "../../../../../src/components/ui/PageShell";
import { TeamPageHeader } from "../../../../../src/features/teams/components/TeamPageHeader";
import { CompetencePlanSection } from "../../../../../src/features/team-competence-plan/components/CompetencePlanSection";

/**
 * `/teams/[teamId]/competence-plan` (BR-15–BR-17). The shared team header is server-rendered; the plan itself loads
 * through the authorized API on the client. Plans need no competence area, and team competence needs and coverage live
 * on Teamkompetanse.
 */
export default async function TeamCompetencePlanPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;

  return (
    <PageShell width="3xl">
      <TeamPageHeader teamId={teamId} />
      <div className="mt-6">
        <CompetencePlanSection teamId={teamId} />
      </div>
    </PageShell>
  );
}

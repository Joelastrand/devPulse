import { PageShell } from "../../../../../src/components/ui/PageShell";
import { TeamPageHeader } from "../../../../../src/features/teams/components/TeamPageHeader";
import { CompetencePlanSection } from "../../../../../src/features/team-competence-plan/components/CompetencePlanSection";

/**
 * `/teams/[teamId]/competence-plan` (BR-15–BR-17). The shared team header is server-rendered; the plan itself loads
 * through the authorized API on the client (TASK-006). Team competence needs and coverage live on Teamkompetanse.
 */
export default async function TeamCompetencePlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ area?: string | string[] }>;
}) {
  const { teamId } = await params;
  const { area } = await searchParams;
  // Only a single string is a preselection; anything else is ignored. The client accepts it only for an unplanned area.
  const initialAreaTreeId = typeof area === "string" && area.length > 0 && area.length <= 200 ? area : null;

  return (
    <PageShell width="3xl">
      <TeamPageHeader teamId={teamId} />
      <div className="mt-6">
        <CompetencePlanSection teamId={teamId} initialAreaTreeId={initialAreaTreeId} />
      </div>
    </PageShell>
  );
}

import { PageShell } from "../../../../../src/components/ui/PageShell";
import { CollaborativeCompetenceProfile } from "../../../../../src/features/team-competence-profile/components/CollaborativeCompetenceProfile";
import { TeamCompetenceCoverage } from "../../../../../src/features/team-skills/components/TeamCompetenceCoverage";
import { TeamSkillTrackingSection } from "../../../../../src/features/teams/components/TeamSubpageSections";
import { TeamPageHeader } from "../../../../../src/features/teams/components/TeamPageHeader";

/**
 * `/teams/[teamId]/competence` (BR-25–BR-27, TASK-011). The profile panel follows the team's stored mode (automatic or
 * collaborative) and the categorical coverage view uses the existing authorized coverage gateway. Both are client-loaded;
 * the server page only renders the shared header and the views.
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
      <div className="mt-6 flex flex-col gap-10">
        <CollaborativeCompetenceProfile teamId={teamId} />
        <TeamSkillTrackingSection teamId={teamId} />
        <TeamCompetenceCoverage teamId={teamId} />
      </div>
    </PageShell>
  );
}

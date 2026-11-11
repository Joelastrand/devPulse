import { PageShell } from "../../../../../src/components/ui/PageShell";
import { CollaborativeCompetenceProfile } from "../../../../../src/features/team-competence-profile/components/CollaborativeCompetenceProfile";
import { TeamCompetenceCoverage } from "../../../../../src/features/team-skills/components/TeamCompetenceCoverage";
import { TeamCompetenceNeedsSection, TeamSkillTrackingSection } from "../../../../../src/features/teams/components/TeamSubpageSections";
import { TeamPageHeader } from "../../../../../src/features/teams/components/TeamPageHeader";

/**
 * `/teams/[teamId]/competence` (BR-25–BR-27, TASK-011). One compact overview (radar, figures, status, per-area list), then a
 * single collapsed container for administration and the detailed sections: levels and areas (teamadmin), competence needs
 * and targets, tracked-area progression and the categorical coverage view. Each section keeps its own server-checked
 * gateway; this server page only renders the shared header and the composition.
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
        <CollaborativeCompetenceProfile
          teamId={teamId}
          detailSections={
            <>
              <TeamCompetenceNeedsSection teamId={teamId} />
              <TeamSkillTrackingSection teamId={teamId} />
              <TeamCompetenceCoverage teamId={teamId} />
            </>
          }
        />
      </div>
    </PageShell>
  );
}

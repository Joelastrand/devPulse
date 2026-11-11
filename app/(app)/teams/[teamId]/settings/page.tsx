import { PageShell } from "../../../../../src/components/ui/PageShell";
import { TeamSettingsSections } from "../../../../../src/features/teams/components/TeamSubpageSections";
import { TeamPageHeader } from "../../../../../src/features/teams/components/TeamPageHeader";

/**
 * `/teams/[teamId]/settings` (team-experience-redesign, Teaminnstillinger). The shared header and the team settings
 * sections. The competence profile mode is no longer a setting: the one Teamkompetanse page offers both modes.
 */
export default async function TeamSettingsPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;

  return (
    <PageShell width="3xl">
      <TeamPageHeader teamId={teamId} />
      <div className="mt-10">
        <TeamSettingsSections teamId={teamId} />
      </div>
    </PageShell>
  );
}

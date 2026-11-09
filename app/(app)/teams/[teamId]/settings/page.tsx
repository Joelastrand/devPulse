import { PageShell } from "../../../../../src/components/ui/PageShell";
import { TeamSettingsCompetenceProfile } from "../../../../../src/features/team-competence-profile/components/TeamSettingsCompetenceProfile";
import { TEAM_SETTINGS_COPY } from "../../../../../src/features/team-competence-profile/copy";
import { TeamSettingsSections } from "../../../../../src/features/teams/components/TeamSubpageSections";
import { TeamPageHeader } from "../../../../../src/features/teams/components/TeamPageHeader";

/**
 * `/teams/[teamId]/settings` (team-experience-redesign, Teaminnstillinger). The shared header and the competence-profile
 * mode section. The section loads its own data client-side; the server decides who may change the mode.
 */
export default async function TeamSettingsPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;

  return (
    <PageShell width="3xl">
      <TeamPageHeader teamId={teamId} />
      <h2 className="mt-6 text-xl font-semibold text-text-primary">{TEAM_SETTINGS_COPY.pageTitle}</h2>
      <div className="mt-6">
        <TeamSettingsCompetenceProfile teamId={teamId} />
      </div>
      <div className="mt-10">
        <TeamSettingsSections teamId={teamId} />
      </div>
    </PageShell>
  );
}

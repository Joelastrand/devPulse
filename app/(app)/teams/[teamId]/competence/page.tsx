import { PageShell } from "../../../../../src/components/ui/PageShell";
import { TeamCompetenceWorkspace } from "../../../../../src/features/team-owned-skills/components/TeamCompetenceWorkspace";
import { TeamPageHeader } from "../../../../../src/features/teams/components/TeamPageHeader";

/**
 * `/teams/[teamId]/competence` (Teamkompetanse). One team competence page: the canonical team skill catalog (for
 * administrators), the automatic profile and the collaborative profile. The server authorizes every read and write; this
 * page only renders the shared header and the client workspace.
 */
export default async function TeamCompetencePage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;

  return (
    <PageShell width="3xl">
      <TeamPageHeader teamId={teamId} />
      <div className="mt-6">
        <TeamCompetenceWorkspace teamId={teamId} />
      </div>
    </PageShell>
  );
}

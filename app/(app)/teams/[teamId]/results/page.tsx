import { PageShell } from "../../../../../src/components/ui/PageShell";
import { TeamPageHeader } from "../../../../../src/features/teams/components/TeamPageHeader";
import { TeamResultsView } from "../../../../../src/features/teams/components/TeamResultsView";

/**
 * `/teams/[teamId]/results` (docs/archive/features/team-experience-redesign SPEC — BR-5).
 * Survey history, trends and the long competence ladder moved here from the
 * Oversikt. The server page only renders the shared header and a back link;
 * the authorized data is loaded client-side through the existing results and
 * current-survey gateways, which enforce team authorization on the server.
 */
export default async function TeamResultsPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;

  return (
    <PageShell width="3xl">
      <TeamPageHeader teamId={teamId} />
      <div className="mt-6 flex flex-col gap-6">
        <TeamResultsView teamId={teamId} />
      </div>
    </PageShell>
  );
}

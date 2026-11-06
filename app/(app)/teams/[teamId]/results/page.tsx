import Link from "next/link";
import { PageShell } from "../../../../../src/components/ui/PageShell";
import { TeamPageHeader } from "../../../../../src/features/teams/components/TeamPageHeader";
import { TeamResultsView } from "../../../../../src/features/teams/components/TeamResultsView";
import { teamsCopy } from "../../../../../src/features/teams/copy";

/**
 * `/teams/[teamId]/results` (docs/features/team-experience-redesign SPEC — BR-5).
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
        <Link
          href={`/teams/${encodeURIComponent(teamId)}`}
          className="w-fit text-label font-medium text-text-secondary underline-offset-2 hover:text-text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {teamsCopy.results.backToOverview}
        </Link>
        <TeamResultsView teamId={teamId} />
      </div>
    </PageShell>
  );
}

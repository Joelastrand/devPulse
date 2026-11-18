import { Suspense } from "react";
import { PageShell } from "../../../../../../src/components/ui/PageShell";
import { TeamSystemDetailPage } from "../../../../../../src/features/team-systems/components/TeamSystemDetailPage";

/** `/teams/[teamId]/systems/[systemId]` (Phase 2F). The client page loads the authorized team list and shows one system. */
export default async function TeamSystemDetailRoutePage({
  params,
}: {
  params: Promise<{ teamId: string; systemId: string }>;
}) {
  const { teamId, systemId } = await params;

  // The page reads the optional `from` return state from the URL (useSearchParams), which needs a Suspense boundary.
  return (
    <PageShell width="wide">
      <Suspense fallback={null}>
        <TeamSystemDetailPage teamId={teamId} systemId={systemId} />
      </Suspense>
    </PageShell>
  );
}

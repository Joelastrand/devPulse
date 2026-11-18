import { Suspense } from "react";
import { PageShell } from "../../../../../src/components/ui/PageShell";
import { TeamSystemsPage } from "../../../../../src/features/team-systems/components/TeamSystemsPage";

export default async function TeamSystemsRoutePage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;

  // The page reads its browsing state from the URL (useSearchParams), which needs a Suspense boundary.
  return (
    <PageShell width="wide">
      <Suspense fallback={null}>
        <TeamSystemsPage teamId={teamId} />
      </Suspense>
    </PageShell>
  );
}

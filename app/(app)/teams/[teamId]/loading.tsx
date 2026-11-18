import { PageShell } from "../../../../src/components/ui/PageShell";
import { TeamOverviewSkeleton } from "../../../../src/features/teams/components/TeamOverviewSkeleton";

/**
 * Shown while a team tab's server page is prepared during a navigation. It reads no team data and shows no team
 * content. It uses the same layout-matched skeleton as the client-side team overview, so the page keeps its shape
 * from the route boundary through to the loaded view.
 */
export default function TeamRouteLoading() {
  return (
    <PageShell width="3xl">
      <TeamOverviewSkeleton label="Laster teamet…" />
    </PageShell>
  );
}

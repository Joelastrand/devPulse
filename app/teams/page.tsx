import { PageHeader } from "../../src/components/ui/PageHeader";
import { PageShell } from "../../src/components/ui/PageShell";
import { TeamsOverview } from "../../src/features/teams/components/TeamsOverview";
import { teamsCopy } from "../../src/features/teams/copy";

export default function TeamsPage() {
  return (
    <PageShell width="3xl">
      <PageHeader
        title={teamsCopy.overview.pageTitle}
        description={teamsCopy.overview.pageDescription}
      />
      <div className="mt-6">
        <TeamsOverview />
      </div>
    </PageShell>
  );
}

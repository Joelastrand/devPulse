import { PageHeader } from "../../../src/components/ui/PageHeader";
import { PageShell } from "../../../src/components/ui/PageShell";
import { adminCopy } from "../../../src/features/teams/copy";
import { AdminTeams } from "../../../src/features/teams/components/AdminTeams";

export default function AdminTeamsPage() {
  return (
    <PageShell width="3xl">
      <PageHeader title={adminCopy.teams.pageTitle} description={adminCopy.teams.pageDescription} />
      <div className="mt-6">
        <AdminTeams />
      </div>
    </PageShell>
  );
}

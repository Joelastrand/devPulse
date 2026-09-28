import Link from "next/link";
import { PageHeader } from "../../../src/components/ui/PageHeader";
import { PageShell } from "../../../src/components/ui/PageShell";
import { adminCopy } from "../../../src/features/teams/copy";
import { AdminTeams } from "../../../src/features/teams/components/AdminTeams";

export default function AdminTeamsPage() {
  return (
    <PageShell width="wide">
      <PageHeader title={adminCopy.teams.pageTitle} description={adminCopy.teams.pageDescription} />
      <p className="mt-2">
        <Link href="/admin/skills" className="font-medium text-zinc-900 underline dark:text-zinc-50">
          Kompetanseområder
        </Link>
      </p>
      <div className="mt-6">
        <AdminTeams />
      </div>
    </PageShell>
  );
}

import Link from "next/link";
import { GraduationCap, UserRoundCog } from "lucide-react";
import { PageHeader } from "../../../../src/components/ui/PageHeader";
import { ADMIN_SCOPE_EYEBROW } from "../../../../src/components/ui/copy";
import { PageShell } from "../../../../src/components/ui/PageShell";
import { Icon } from "../../../../src/components/ui/Icon";
import { buttonClassName } from "../../../../src/components/ui/Button";
import { adminCopy } from "../../../../src/features/teams/copy";
import { AdminTeams } from "../../../../src/features/teams/components/AdminTeams";

export default function AdminTeamsPage() {
  return (
    <PageShell width="wide">
      <PageHeader eyebrow={ADMIN_SCOPE_EYEBROW} title={adminCopy.teams.pageTitle} description={adminCopy.teams.pageDescription} />
      {/* Contextual links to related administration areas. Kept compact and secondary; the sidebar remains the primary navigation. */}
      <nav aria-label={adminCopy.teams.relatedAreasLabel} className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/admin/skills"
          className={buttonClassName({ variant: "tertiary", size: "sm", className: "inline-flex items-center gap-2" })}
        >
          <Icon icon={GraduationCap} size="inline" />
          {adminCopy.teams.competenceAreasLink}
        </Link>
        <Link
          href="/admin/roles"
          className={buttonClassName({ variant: "tertiary", size: "sm", className: "inline-flex items-center gap-2" })}
        >
          <Icon icon={UserRoundCog} size="inline" />
          {adminCopy.teams.rolesLink}
        </Link>
      </nav>
      <div className="mt-6">
        <AdminTeams />
      </div>
    </PageShell>
  );
}

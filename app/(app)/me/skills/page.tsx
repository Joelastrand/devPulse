import Link from "next/link";
import { BriefcaseBusiness, LayoutDashboard, Radar, Users, type LucideIcon } from "lucide-react";
import { PageHeader } from "../../../../src/components/ui/PageHeader";
import { PageShell } from "../../../../src/components/ui/PageShell";
import { SkillOverview } from "../../../../src/features/skill-profiles/components/SkillOverview";
import { SkillProfilePage } from "../../../../src/features/skill-profiles/components/SkillProfilePage";
import { skillProfileCopy, skillViewCopy } from "../../../../src/features/skill-profiles/copy";
import { RoleWorkspace } from "../../../../src/features/personal-role-workspace/components/RoleWorkspace";
import { OwnCompetenceSharing } from "../../../../src/features/team-skills/components/OwnCompetenceSharing";
import { OwnTeamSkillsSection } from "../../../../src/features/team-owned-skills/components/OwnTeamSkillsSection";

/**
 * The four route-backed views of `/me/skills`, selected by `?vy=`. Only the selected view is rendered, so switching never
 * keeps two views mounted. Each view reads its own data through its client components; the editing form is not part of
 * the overview. An unknown or missing `vy` falls back to the overview.
 */
type SkillView = (typeof skillViewCopy.tabs)[number]["view"];
const VIEWS: readonly SkillView[] = skillViewCopy.tabs.map((tab) => tab.view);

/** Decorative only: every tab keeps its visible text label, so the icon never carries meaning on its own. */
const TAB_ICONS: Readonly<Record<SkillView, LucideIcon>> = {
  oversikt: LayoutDashboard,
  rediger: Radar,
  rolle: BriefcaseBusiness,
  deling: Users,
};

function selectedView(value: string | string[] | undefined): SkillView {
  const requested = Array.isArray(value) ? value[0] : value;
  return VIEWS.find((view) => view === requested) ?? "oversikt";
}

export default async function MySkillsPage({
  searchParams,
}: {
  searchParams: Promise<{ vy?: string | string[] }>;
}) {
  const view = selectedView((await searchParams).vy);

  return (
    <PageShell width="wide">
      <PageHeader title={skillProfileCopy.pageTitle} description={skillProfileCopy.pageDescription} />
      <nav aria-label={skillViewCopy.navLabel} className="mt-4 border-b border-border-subtle">
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {skillViewCopy.tabs.map((tab) => {
            const current = tab.view === view;
            const Icon = TAB_ICONS[tab.view];
            return (
              <li key={tab.view}>
                <Link
                  href={`/me/skills?vy=${tab.view}`}
                  aria-current={current ? "page" : undefined}
                  className={`-mb-px inline-flex items-center gap-2 border-b-2 px-1 pb-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 ${
                    current
                      ? "border-text-primary text-text-primary"
                      : "border-transparent text-text-secondary hover:text-text-primary"
                  }`}
                >
                  <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="mt-6">
        {view === "oversikt" ? <SkillOverview /> : null}
        {view === "rediger" ? (
          <div className="flex flex-col gap-10">
            <SkillProfilePage />
            {/* Team-owned skills (docs/features/team-owned-skills): one block per team the person belongs to. */}
            <OwnTeamSkillsSection />
          </div>
        ) : null}
        {/* The route id stays `rolle` for backward compatibility; the label is "Min rolle og mine bidrag". */}
        {view === "rolle" ? <RoleWorkspace /> : null}
        {/* Sharing is a separate, explicit, default-off choice per team membership (BR-21, SECURITY invariant 32). */}
        {view === "deling" ? (
          <div id="deling" className="rounded-lg border border-border-subtle bg-surface p-4 shadow-sm">
            <OwnCompetenceSharing />
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}

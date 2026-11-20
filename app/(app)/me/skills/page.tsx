import Link from "next/link";
import { BriefcaseBusiness, Layers, LayoutDashboard, Radar, Users, type LucideIcon } from "lucide-react";
import { PageHeader } from "../../../../src/components/ui/PageHeader";
import { PageShell } from "../../../../src/components/ui/PageShell";
import { SkillOverview } from "../../../../src/features/skill-profiles/components/SkillOverview";
import { SkillProfilePage } from "../../../../src/features/skill-profiles/components/SkillProfilePage";
import { SkillCatalogIntro } from "../../../../src/features/skill-profiles/components/SkillCatalogIntro";
import { skillCatalogCopy, skillProfileCopy, skillViewCopy } from "../../../../src/features/skill-profiles/copy";
import { RoleWorkspace } from "../../../../src/features/personal-role-workspace/components/RoleWorkspace";
import { OwnCompetenceSharing } from "../../../../src/features/team-skills/components/OwnCompetenceSharing";
import { OwnTeamSkillsSection } from "../../../../src/features/team-owned-skills/components/OwnTeamSkillsSection";

/**
 * The route-backed views of `/me/skills`, selected by `?vy=`. Only the selected view is rendered, so switching never keeps
 * two views mounted. `rediger` is the personal skill assessment (its route value predates the label); `teamkompetanser` is
 * the separate team competency view. An unknown or missing `vy` falls back to the overview.
 */
type SkillView = (typeof skillViewCopy.tabs)[number]["view"];
const VIEWS: readonly SkillView[] = skillViewCopy.tabs.map((tab) => tab.view);

/** Decorative only: every tab keeps its visible text label, so the icon never carries meaning on its own. */
const TAB_ICONS: Readonly<Record<SkillView, LucideIcon>> = {
  oversikt: LayoutDashboard,
  rediger: Radar,
  teamkompetanser: Layers,
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
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {skillViewCopy.tabs.map((tab) => {
            const current = tab.view === view;
            const Icon = TAB_ICONS[tab.view];
            return (
              <li key={tab.view}>
                <Link
                  href={`/me/skills?vy=${tab.view}`}
                  aria-current={current ? "page" : undefined}
                  className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-1 pb-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 ${
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
          <div className="flex flex-col gap-6">
            <SkillCatalogIntro
              id="what-is-personal-skills"
              intro={skillCatalogCopy.personal.intro}
              whatIsTitle={skillCatalogCopy.personal.whatIsTitle}
              whatIsBody={skillCatalogCopy.personal.whatIsBody}
            />
            <SkillProfilePage />
          </div>
        ) : null}
        {view === "teamkompetanser" ? (
          <div className="flex flex-col gap-6">
            <SkillCatalogIntro
              id="what-is-team-competences"
              intro={skillCatalogCopy.team.intro}
              whatIsTitle={skillCatalogCopy.team.whatIsTitle}
              whatIsBody={skillCatalogCopy.team.whatIsBody}
            >
              <p>
                <Link href={viewHref("deling")} className="font-medium text-text-primary underline underline-offset-2">
                  {skillCatalogCopy.team.delingLinkLabel}
                </Link>
              </p>
            </SkillCatalogIntro>
            {/* One block per team the person belongs to; each team's catalog is defined by that team's administrators. */}
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

function viewHref(view: SkillView): string {
  return `/me/skills?vy=${view}`;
}

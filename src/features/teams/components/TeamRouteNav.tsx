"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, ChartPie, GraduationCap, House, Layers3, ListChecks, type LucideIcon } from "lucide-react";
import { Icon } from "../../../components/ui/Icon";
import { teamSkillsCopy } from "../../team-owned-skills/copy";
import { teamsCopy } from "../copy";

/** Strips a single trailing slash so `/teams/x/` and `/teams/x` compare equal. */
function normalizePathname(pathname: string | null): string | null {
  if (pathname === null) {
    return null;
  }
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * Route-level team navigation with the five team tabs of
 * docs/features/team-experience-redesign/SPEC.md (BR-30):
 * `Oversikt · Roadmap · Kompetanseplan · Teamkompetanse · Systemoversikt`.
 * `aria-current="page"` is set on an exact pathname match only — no prefix
 * matching, so other sub-routes (e.g. the forum thread page) and unknown
 * paths mark nothing. Each tab has a decorative icon; the text label is the accessible name.
 */
export function TeamRouteNav({ teamId }: { teamId: string }) {
  const pathname = normalizePathname(usePathname());
  const base = `/teams/${encodeURIComponent(teamId)}`;
  const links: readonly { href: string; label: string; icon: LucideIcon }[] = [
    { href: base, label: teamsCopy.nav.overview, icon: House },
    { href: `${base}/roadmap`, label: teamsCopy.nav.roadmap, icon: CalendarDays },
    { href: `${base}/competence-plan`, label: teamsCopy.nav.competencePlan, icon: GraduationCap },
    { href: `${base}/competence`, label: teamsCopy.nav.competence, icon: ChartPie },
    { href: `${base}/systems`, label: teamsCopy.nav.systems, icon: Layers3 },
    { href: `${base}/skills`, label: teamSkillsCopy.nav, icon: ListChecks },
  ];

  return (
    <nav aria-label={teamsCopy.nav.label}>
      <ul className="flex flex-wrap gap-1 border-b border-border-subtle">
        {links.map((link) => {
          const current = pathname === link.href;
          return (
            <li key={link.href} className="shrink-0">
              <Link
                href={link.href}
                aria-current={current ? "page" : undefined}
                className={
                  "-mb-px flex items-center gap-2 border-b-2 px-3 py-3 text-label focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary sm:px-4 " +
                  (current
                    ? "border-primary font-semibold text-primary"
                    : "border-transparent font-medium text-text-secondary hover:border-border-strong hover:text-text-primary")
                }
              >
                <Icon icon={link.icon} size="action" className="shrink-0" />
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

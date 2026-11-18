"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  CalendarRange,
  ChartNoAxesCombined,
  ChartPie,
  ClipboardList,
  GraduationCap,
  House,
  Layers3,
  type LucideIcon,
} from "lucide-react";
import { Icon } from "../../../components/ui/Icon";
import { teamsCopy } from "../copy";

/** Strips a single trailing slash so `/teams/x/` and `/teams/x` compare equal. */
function normalizePathname(pathname: string | null): string | null {
  if (pathname === null) {
    return null;
  }
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * Route-level team navigation: the seven team destinations
 * `Oversikt · Roadmap · Kompetanseplan · Teamkompetanse · Systemoversikt · Resultater og trender · Undersøkelser`.
 * `aria-current="page"` is set on an exact pathname match only — no prefix
 * matching, so other sub-routes (e.g. the forum thread page) and unknown
 * paths mark nothing. Each tab has a decorative icon; the text label is the accessible name.
 * On narrow screens the tab row scrolls horizontally, and the active tab is scrolled into view.
 */
export function TeamRouteNav({ teamId }: { teamId: string }) {
  const pathname = normalizePathname(usePathname());
  const activeLinkRef = useRef<HTMLAnchorElement | null>(null);
  const base = `/teams/${encodeURIComponent(teamId)}`;
  const links: readonly { href: string; label: string; icon: LucideIcon; matchChildren?: boolean }[] = [
    { href: base, label: teamsCopy.nav.overview, icon: House },
    { href: `${base}/roadmap`, label: teamsCopy.nav.roadmap, icon: CalendarRange },
    { href: `${base}/competence-plan`, label: teamsCopy.nav.competencePlan, icon: GraduationCap },
    { href: `${base}/competence`, label: teamsCopy.nav.competence, icon: ChartPie },
    { href: `${base}/systems`, label: teamsCopy.nav.systems, icon: Layers3, matchChildren: true },
    { href: `${base}/results`, label: teamsCopy.nav.results, icon: ChartNoAxesCombined },
    { href: `${base}/surveys`, label: teamsCopy.nav.surveys, icon: ClipboardList },
  ];

  // Keep the active tab visible when the tab row scrolls. `block: "nearest"` avoids any vertical page scroll.
  useEffect(() => {
    const element = activeLinkRef.current;
    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [pathname]);

  return (
    <nav aria-label={teamsCopy.nav.label} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max min-w-full gap-1 border-b border-border-subtle sm:w-auto sm:min-w-0">
        {links.map((link) => {
          // Systemoversikt also stays active on its own system detail pages (`/systems/[systemId]`), the one longest-prefix case.
          const current =
            pathname === link.href || (link.matchChildren === true && pathname !== null && pathname.startsWith(`${link.href}/`));
          return (
            <li key={link.href} className="shrink-0">
              <Link
                ref={current ? activeLinkRef : undefined}
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

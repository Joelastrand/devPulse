"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
 * paths mark nothing.
 */
export function TeamRouteNav({ teamId }: { teamId: string }) {
  const pathname = normalizePathname(usePathname());
  const base = `/teams/${encodeURIComponent(teamId)}`;
  const links = [
    { href: base, label: teamsCopy.nav.overview },
    { href: `${base}/roadmap`, label: teamsCopy.nav.roadmap },
    { href: `${base}/competence-plan`, label: teamsCopy.nav.competencePlan },
    { href: `${base}/competence`, label: teamsCopy.nav.competence },
    { href: `${base}/systems`, label: teamsCopy.nav.systems },
  ];

  return (
    <nav aria-label={teamsCopy.nav.label}>
      <ul className="flex flex-wrap gap-1 border-b border-border-subtle">
        {links.map((link) => {
          const current = pathname === link.href;
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={current ? "page" : undefined}
                className={
                  current
                    ? "-mb-px block border-b-2 border-primary px-4 py-3 text-label font-semibold text-text-primary"
                    : "-mb-px block border-b-2 border-transparent px-4 py-3 text-label font-medium text-text-secondary hover:text-text-primary"
                }
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

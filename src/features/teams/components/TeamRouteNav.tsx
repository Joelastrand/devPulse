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
 * Route-level team navigation: exactly `Oversikt · Roadmap`
 * (docs/features/team-roadmap/SPEC.md — BR-2). Kompetanse stays a section of
 * Oversikt, never a destination. `aria-current="page"` is set on an exact
 * pathname match only — no prefix matching, so other sub-routes (e.g. the
 * forum thread page) and unknown paths mark nothing.
 */
export function TeamRouteNav({ teamId }: { teamId: string }) {
  const pathname = normalizePathname(usePathname());
  const base = `/teams/${encodeURIComponent(teamId)}`;
  const links = [
    { href: base, label: teamsCopy.nav.overview },
    { href: `${base}/roadmap`, label: teamsCopy.nav.roadmap },
  ];

  return (
    <nav aria-label={teamsCopy.nav.label}>
      <ul className="flex flex-wrap gap-x-4 gap-y-2">
        {links.map((link) => {
          const current = pathname === link.href;
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={current ? "page" : undefined}
                className={
                  current
                    ? "font-semibold text-zinc-900 underline underline-offset-4 dark:text-zinc-50"
                    : "text-zinc-600 hover:underline dark:text-zinc-400"
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

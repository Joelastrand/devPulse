"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navCopy } from "./copy";

const PERSONAL_LINKS = [
  { href: "/me/skills", label: navCopy.personalSkills },
  { href: "/me/goals", label: navCopy.personalGoals },
  { href: "/me/conversations", label: navCopy.personalConversations },
] as const;

/**
 * Page-level navigation shared by the personal development pages (docs/features/personal-development-goals/
 * SPEC.md — BR-47). Static links only: no data, no role or identity logic. The entry whose href equals the
 * current pathname exactly is marked current.
 */
export function PersonalNav() {
  const pathname = usePathname();

  return (
    <nav aria-label={navCopy.personalNavLabel}>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
        {PERSONAL_LINKS.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              aria-current={pathname === link.href ? "page" : undefined}
              className="hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

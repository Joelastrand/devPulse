"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "../ui/BrandMark";
import { cx } from "../ui/class-names";
import { navCopy } from "./copy";

const PUBLIC_LINKS = [
  { href: "/", label: navCopy.home },
  { href: "/sign-in", label: navCopy.signIn },
  { href: "/sign-up", label: navCopy.signUp },
] as const;

const LINK_CLASSNAME =
  "rounded-control px-2 py-2 text-label font-medium text-text-secondary md:px-3 transition-colors duration-micro ease-standard hover:bg-surface-subtle hover:text-text-primary";

/**
 * Top bar for signed-out routes (docs/features/product-experience/SPEC.md —
 * Application shell). It offers only Hjem, Logg inn and Opprett konto. It reads
 * no auth state, so it cannot show signed-in navigation to a signed-out
 * viewer, and it cannot fail open.
 */
export function PublicHeader() {
  const pathname = usePathname();

  return (
    <header className="border-b border-border-subtle bg-surface">
      <div className="mx-auto flex w-full max-w-main flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 md:px-8">
        <span className="flex items-center gap-2.5 text-label font-semibold text-text-primary">
          <BrandMark />
          {navCopy.brand}
        </span>
        <nav aria-label={navCopy.mainNavLabel}>
          <ul className="flex items-center gap-1">
            {PUBLIC_LINKS.map((link) => {
              const current = pathname === link.href;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={current ? "page" : undefined}
                    className={cx(LINK_CLASSNAME, current && "bg-primary-subtle text-primary")}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}

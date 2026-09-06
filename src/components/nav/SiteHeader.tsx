import Link from "next/link";

const NAV_LINKS = [
  { href: "/pulse-survey", label: "Pulse survey" },
  { href: "/results", label: "Results" },
  { href: "/sign-in", label: "Sign in" },
];

/**
 * Static site-wide navigation. Deliberately not auth-aware: there is no
 * reliable shared auth state in a Server Component (Firebase Auth here is
 * client-SDK-only, see `src/features/auth/client/auth-client.ts`), so the
 * header always shows the same links rather than guessing sign-in state.
 */
export function SiteHeader() {
  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-8">
        <Link
          href="/"
          className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
        >
          DevPulse
        </Link>
        <nav aria-label="Main">
          <ul className="flex gap-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
            <li>
              <Link
                href="/"
                className="hover:text-zinc-900 dark:hover:text-zinc-50"
              >
                Home
              </Link>
            </li>
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="hover:text-zinc-900 dark:hover:text-zinc-50"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut } from "../../features/auth/client/auth-client";
import { useAuthGatedResource } from "../../features/auth/client/use-auth-gated-resource";
import { fetchOwnAdminStatus } from "../../features/teams/client/own-admin-status-gateway";
import { Button } from "../ui/Button";
import { navCopy } from "./copy";

type HeaderState =
  | { phase: "loading" }
  | { phase: "signed_out" }
  | { phase: "signed_in"; generation: number; isAdmin: boolean };

interface NavLink {
  href: string;
  label: string;
}

/**
 * Site-wide navigation, auth- and admin-aware
 * (docs/features/product-ux-shell/SPEC.md — BR-4 through BR-7, BR-15's
 * header states). Sign-in state comes only from the client's own Firebase
 * ID token (`observeIdToken`, via the shared `useAuthGatedResource`
 * generation guard); Admin-link visibility comes only from TASK-004's
 * `GET /api/me` — never a client-evaluated `APP_ADMIN_EMAILS` check or any
 * other client-supplied flag. Both fail closed: before the first token
 * emission and on any admin-status read failure (or one still in flight),
 * this renders as if the caller is signed out / not an admin, never the
 * reverse (SPEC edge case — "never a false positive").
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [state, setState] = useState<HeaderState>({ phase: "loading" });
  const [signingOut, setSigningOut] = useState(false);

  const { isCurrentGeneration } = useAuthGatedResource((token, generation, isCurrentGenerationAtCall) => {
    setSigningOut(false);

    if (!token) {
      setState({ phase: "signed_out" });
      return;
    }

    // The signed-in nav set (Team, Logg ut) renders immediately; Admin is
    // added only once a successful own-admin-status read confirms it — an
    // app admin briefly not seeing "Admin" during that read is acceptable
    // (SPEC edge case), a non-admin ever seeing it is not.
    setState({ phase: "signed_in", generation, isAdmin: false });

    fetchOwnAdminStatus(token).then((result) => {
      if (!isCurrentGenerationAtCall(generation)) {
        // Auth has since changed (or the header unmounted); this result
        // belongs to a superseded identity and must not touch current
        // state.
        return;
      }

      if (result.ok && result.isAdmin) {
        setState((previous) =>
          previous.phase === "signed_in" && previous.generation === generation
            ? { ...previous, isAdmin: true }
            : previous,
        );
      }
      // Any other outcome (non-admin, a failed/errored read, or this
      // simply resolving before a newer generation started) leaves
      // `isAdmin: false` — fail closed, never optimistic.
    });
  });

  async function handleSignOut(generation: number) {
    setSigningOut(true);
    await signOut();
    // `observeIdToken` fires with `null` once Firebase completes sign-out,
    // which drives the header back to the signed-out set on its own — no
    // manual state update here. Only reset the pending indicator if this
    // click's generation is still current (it usually won't be, since
    // sign-out itself triggers a new generation).
    if (isCurrentGeneration(generation)) {
      setSigningOut(false);
    }
  }

  const links = navLinksFor(state);

  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-y-2 px-4 py-4 sm:px-8">
        <Link href="/" className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {navCopy.brand}
        </Link>
        <nav aria-label={navCopy.mainNavLabel}>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
            {links.map((link) => (
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
            {state.phase === "signed_in" && (
              <li>
                <Button
                  variant="secondary"
                  size="sm"
                  pending={signingOut}
                  onClick={() => handleSignOut(state.generation)}
                >
                  {signingOut ? navCopy.signingOut : navCopy.signOut}
                </Button>
              </li>
            )}
          </ul>
        </nav>
      </div>
    </header>
  );
}

function navLinksFor(state: HeaderState): NavLink[] {
  if (state.phase === "signed_in") {
    const links: NavLink[] = [
      { href: "/", label: navCopy.home },
      { href: "/pulse-survey", label: navCopy.pulseSurvey },
      { href: "/teams", label: navCopy.teams },
    ];
    if (state.isAdmin) {
      links.push({ href: "/admin/teams", label: navCopy.admin });
    }
    return links;
  }

  // "loading" (before the first auth emission) fails closed to the same
  // set as "signed_out" — an initial render must never show a signed-in-
  // only link to what might be an anonymous visitor.
  return [
    { href: "/", label: navCopy.home },
    { href: "/pulse-survey", label: navCopy.pulseSurvey },
    { href: "/sign-in", label: navCopy.signIn },
    { href: "/sign-up", label: navCopy.signUp },
  ];
}

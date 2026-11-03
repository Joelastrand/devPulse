"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { signOut } from "../../features/auth/client/auth-client";
import { useAuthGatedResource } from "../../features/auth/client/use-auth-gated-resource";
import { fetchOwnAdminStatus } from "../../features/teams/client/own-admin-status-gateway";
import { Button } from "../ui/Button";
import { SKIP_LINK_TARGET_ID } from "../ui/SkipLink";
import { Icon } from "../ui/Icon";
import { BrandMark } from "../ui/BrandMark";
import { SidebarLandscape } from "./SidebarLandscape";
import { MobileDrawer } from "./MobileDrawer";
import { useTeamName } from "./TeamContext";
import { navCopy } from "./copy";
import { NavGroupList, type NavGroup } from "./NavGroupList";

type HeaderState =
  | { phase: "loading" }
  | { phase: "signed_out" }
  | { phase: "signed_in"; generation: number; isAdmin: boolean };

export interface AppShellProps {
  children?: ReactNode;
}

/**
 * Application shell for authenticated routes
 * (docs/features/product-experience/SPEC.md — Application shell, Structure).
 * It replaces the former top header (`SiteHeader`), which is superseded
 * (docs/features/product-ux-shell/SPEC.md). From `md` up it renders a 248 px
 * sidebar. Below `md` it renders a top bar with a Meny trigger that opens
 * `MobileDrawer`. The page content sits inside `data-app-content`, which is
 * made inert and aria-hidden while the drawer is open.
 *
 * Sign-in state comes only from the client's own Firebase ID token
 * (`observeIdToken`, via the shared `useAuthGatedResource` generation guard).
 * Admin-group visibility comes only from `GET /api/me` (own-admin-status). Both
 * fail closed: before the first token emission and on any admin-status read
 * failure or in-flight read, the shell shows the signed-out set. Hiding admin
 * entries is presentation only; admin routes still enforce server authorization.
 *
 * Only existing destinations appear. No destination is added for any role.
 */
export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const [state, setState] = useState<HeaderState>({ phase: "loading" });
  const [signingOut, setSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreMenuFocusRef = useRef(false);
  const headingAfterNavigationRef = useRef(false);

  const { isCurrentGeneration } = useAuthGatedResource((token, generation, isCurrentGenerationAtCall) => {
    setSigningOut(false);

    if (!token) {
      setState({ phase: "signed_out" });
      return;
    }

    // The signed-in set (without Admin) renders immediately; Admin is added
    // only once a successful own-admin-status read confirms it. An app admin
    // briefly not seeing Admin during that read is acceptable (SPEC edge case);
    // a non-admin ever seeing it is not.
    setState({ phase: "signed_in", generation, isAdmin: false });

    fetchOwnAdminStatus(token).then((result) => {
      if (!isCurrentGenerationAtCall(generation)) {
        // Auth has since changed (or the shell unmounted); this result belongs
        // to a superseded identity and must not touch current state.
        return;
      }
      if (result.ok && result.isAdmin) {
        setState((previous) =>
          previous.phase === "signed_in" && previous.generation === generation
            ? { ...previous, isAdmin: true }
            : previous,
        );
      }
      // Any other outcome leaves `isAdmin: false` — fail closed, never optimistic.
    });
  });

  // Focus returns to Meny only after a non-navigation close, once the content
  // is no longer inert (the effect runs after the commit).
  useEffect(() => {
    if (!menuOpen && restoreMenuFocusRef.current) {
      restoreMenuFocusRef.current = false;
      menuTriggerRef.current?.focus();
    }
  }, [menuOpen]);

  // After a navigation link closes the drawer, focus moves to the new page's h1.
  useEffect(() => {
    if (!headingAfterNavigationRef.current) return;
    headingAfterNavigationRef.current = false;
    const heading = document.querySelector<HTMLElement>("h1");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus();
    }
  }, [pathname]);

  async function handleSignOut(generation: number) {
    setSigningOut(true);
    await signOut();
    // `observeIdToken` fires with `null` once Firebase completes sign-out,
    // which drives the shell back to the signed-out set on its own. Only reset
    // the pending indicator if this click's generation is still current.
    if (isCurrentGeneration(generation)) {
      setSigningOut(false);
    }
  }

  const teamName = useTeamName();
  const groups = navGroupsFor(state, teamName);
  const signOutAction =
    state.phase === "signed_in"
      ? { pending: signingOut, onSignOut: () => handleSignOut(state.generation) }
      : undefined;
  const currentLabel = groups.flatMap((group) => group.items).find((item) => item.href === pathname)?.label;

  return (
    <>
      <div
        data-app-content
        inert={menuOpen || undefined}
        aria-hidden={menuOpen || undefined}
        className="flex min-h-full flex-1 flex-col"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border-subtle bg-surface px-4 py-3 md:hidden">
          <div className="min-w-0">
            <p className="text-help text-text-muted">{navCopy.brand}</p>
            <p className="truncate text-label font-semibold text-text-primary">{currentLabel ?? navCopy.brand}</p>
          </div>
          <Button
            ref={menuTriggerRef}
            variant="secondary"
            size="sm"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <Icon icon={Menu} size="inline" />
            {navCopy.menu}
          </Button>
        </header>
        <div className="flex flex-1">
          <aside className="relative hidden w-[248px] shrink-0 overflow-hidden bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:block md:h-screen md:overflow-y-auto">
            <SidebarLandscape />
            <div className="relative flex flex-col gap-6 p-4">
              <Link href="/" className="flex items-center gap-2.5 px-3 py-1 text-label font-semibold text-sidebar-foreground">
                <BrandMark />
                {navCopy.brand}
              </Link>
              <nav aria-label={navCopy.mainNavLabel} className="flex flex-col gap-6">
                <NavGroupList groups={groups} pathname={pathname} signOut={signOutAction} />
              </nav>
            </div>
          </aside>
          <div id={SKIP_LINK_TARGET_ID} tabIndex={-1} className="min-w-0 flex-1">
            {children}
          </div>
        </div>
      </div>
      {menuOpen ? (
        <MobileDrawer
          groups={groups}
          pathname={pathname}
          signOut={signOutAction}
          onNavigate={() => {
            headingAfterNavigationRef.current = true;
            setMenuOpen(false);
          }}
          onClose={({ restoreFocus }) => {
            restoreMenuFocusRef.current = restoreFocus;
            setMenuOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function navGroupsFor(state: HeaderState, teamName: string | null): NavGroup[] {
  if (state.phase === "signed_in") {
    const groups: NavGroup[] = [
      { key: "overview", items: [{ href: "/", label: navCopy.home }] },
      { key: "team", heading: teamName ?? undefined, items: [{ href: "/teams", label: navCopy.teams }] },
      {
        key: "personal",
        heading: navCopy.personalDevelopment,
        items: [
          { href: "/me/skills", label: navCopy.personalSkills },
          { href: "/me/goals", label: navCopy.personalGoals },
          { href: "/me/conversations", label: navCopy.personalConversations },
        ],
      },
    ];
    if (state.isAdmin) {
      groups.push({
        key: "admin",
        heading: navCopy.administration,
        items: [{ href: "/admin/teams", label: navCopy.admin }],
      });
    }
    groups.push({
      key: "user",
      items: [
        { href: "/me/profile", label: navCopy.profile },
        { href: "/me/erasure", label: navCopy.deleteAccount },
      ],
    });
    return groups;
  }
  // "loading" (before the first auth emission) fails closed to the same set as
  // "signed_out": an initial render must never show a signed-in-only link to a
  // possibly anonymous visitor.
  return [
    {
      key: "overview",
      items: [
        { href: "/", label: navCopy.home },
        { href: "/sign-in", label: navCopy.signIn },
        { href: "/sign-up", label: navCopy.signUp },
      ],
    },
  ];
}

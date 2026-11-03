"use client";

import Link from "next/link";
import { Button } from "../ui/Button";
import { cx } from "../ui/class-names";
import { navCopy } from "./copy";

export interface NavItem {
  href: string;
  label: string;
}

export interface NavGroup {
  key: string;
  /** Visible group heading, rendered as text rather than a heading element. */
  heading?: string;
  items: NavItem[];
}

export interface NavSignOut {
  pending: boolean;
  onSignOut: () => void;
}

const LINK_CLASSNAME =
  "block rounded-control px-3 py-2 text-label font-medium transition-colors duration-micro ease-standard";
// Navigation sits on the dark sidebar surface in both the desktop sidebar and the drawer.
const IDLE_LINK_CLASSNAME = "text-sidebar-muted hover:bg-sidebar-active hover:text-sidebar-foreground";
const CURRENT_LINK_CLASSNAME = "bg-sidebar-active text-sidebar-foreground";

/**
 * The grouped navigation list shared by the desktop sidebar and the mobile
 * drawer (docs/features/product-experience/SPEC.md — Application shell). The
 * caller supplies the `<nav>` landmark. Only the group that holds `signOut` gets
 * the Logg ut action, so the two presentations cannot drift apart.
 */
export function NavGroupList({
  groups,
  pathname,
  onNavigate,
  signOut,
}: {
  groups: NavGroup[];
  pathname: string;
  onNavigate?: () => void;
  signOut?: NavSignOut;
}) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-1">
          {group.heading ? (
            <p className="px-3 pb-1 text-help font-medium text-sidebar-muted">{group.heading}</p>
          ) : null}
          <ul className="flex flex-col gap-1">
            {group.items.map((item) => {
              const current = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    onClick={onNavigate}
                    className={cx(LINK_CLASSNAME, current ? CURRENT_LINK_CLASSNAME : IDLE_LINK_CLASSNAME)}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
            {group.key === "user" && signOut ? (
              <li>
                <Button
                  variant="tertiary"
                  size="sm"
                  pending={signOut.pending}
                  className="w-full justify-start text-sidebar-muted hover:bg-sidebar-active hover:text-sidebar-foreground"
                  onClick={signOut.onSignOut}
                >
                  {signOut.pending ? navCopy.signingOut : navCopy.signOut}
                </Button>
              </li>
            ) : null}
          </ul>
        </div>
      ))}
    </>
  );
}

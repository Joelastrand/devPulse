"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Icon } from "../ui/Icon";
import { cx } from "../ui/class-names";

export interface NavItem {
  href: string;
  label: string;
  /** Decorative: the visible label already names the destination (BR-13). */
  icon?: LucideIcon;
}

export interface NavGroup {
  key: string;
  /** Visible group heading, rendered as text rather than a heading element. */
  heading?: string;
  /** Muted context line under the heading, such as the current team's name. */
  context?: string;
  items: NavItem[];
}

export interface NavSignOut {
  pending: boolean;
  onSignOut: () => void;
}

const LINK_CLASSNAME =
  "flex items-center gap-2 rounded-control px-3 py-2 text-label font-medium transition-colors duration-micro ease-standard";
// Navigation sits on the dark sidebar surface in both the desktop sidebar and the drawer.
const IDLE_LINK_CLASSNAME = "text-sidebar-muted hover:bg-sidebar-active hover:text-sidebar-foreground";
const CURRENT_LINK_CLASSNAME = "bg-sidebar-active text-sidebar-foreground";

/**
 * The grouped navigation list shared by the desktop sidebar and the mobile
 * drawer (docs/archive/features/product-experience/SPEC.md — Application shell). The
 * caller supplies the `<nav>` landmark. Sign-out is not part of the list: it lives
 * only in the top-bar account menu (BR-17, D-4).
 */
export function NavGroupList({
  groups,
  pathname,
  onNavigate,
}: {
  groups: NavGroup[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-1">
          {group.heading ? (
            <p className="px-3 pb-1 text-help font-medium text-sidebar-muted">{group.heading}</p>
          ) : null}
          {group.context ? <p className="px-3 pb-1 text-help text-sidebar-muted">{group.context}</p> : null}
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
                    {item.icon ? <Icon icon={item.icon} size="inline" /> : null}
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}

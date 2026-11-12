"use client";

import Link from "next/link";
import { ChevronDown, User } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { cx } from "../ui/class-names";
import { navCopy } from "./copy";
import type { NavSignOut } from "./NavGroupList";

const PROFILE_HREF = "/me/profile";

/** Focusable items inside the open panel, in DOM order (arrow-key navigation). */
function menuItems(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return Array.from(panel.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
}

/**
 * Account menu in the top bar (rendered at all widths; the sign-out control lives only here) (docs/archive/features/visual-redesign/SPEC.md —
 * BR-1, AD-8). A disclosure: the trigger toggles a panel that is rendered only
 * while open, so the menu's links never duplicate the sidebar's links while
 * closed. Escape and an outside pointer press close it; Escape returns focus to
 * the trigger. Sign-out is the same action the sidebar uses.
 */
export function AccountMenu({ pathname, signOut }: { pathname: string; signOut?: NavSignOut }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const items = menuItems(panelRef.current);
        if (items.length === 0) return;
        event.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLElement);
        const step = event.key === "ArrowDown" ? 1 : -1;
        const next = current === -1 ? 0 : (current + step + items.length) % items.length;
        items[next]?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) firstItemRef.current?.focus();
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <Button
        ref={triggerRef}
        variant="tertiary"
        size="sm"
        className="min-h-11 min-w-11 inline-flex items-center gap-2 whitespace-nowrap"
        aria-haspopup="true"
        aria-expanded={open}
        // aria-controls points only at the rendered panel: the panel exists only while open (below).
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((previous) => !previous)}
      >
        <Icon icon={User} size="inline" />
        {navCopy.accountMenu}
        <Icon icon={ChevronDown} size="inline" />
      </Button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          className="absolute right-0 top-full z-20 mt-2 flex w-56 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-surface border border-border-subtle bg-surface p-2 shadow-elevated"
        >
          <Link
            ref={firstItemRef}
            href={PROFILE_HREF}
            aria-current={pathname === PROFILE_HREF ? "page" : undefined}
            onClick={() => setOpen(false)}
            className={cx(
              "block min-h-11 rounded-control px-3 py-2 text-label font-medium",
              pathname === PROFILE_HREF
                ? "bg-primary-subtle text-text-primary"
                : "text-text-secondary hover:bg-surface-subtle hover:text-text-primary",
            )}
          >
            {navCopy.profile}
          </Link>
          {signOut ? (
            <Button
              variant="tertiary"
              size="sm"
              pending={signOut.pending}
              className="min-h-11 w-full justify-start"
              onClick={() => {
                setOpen(false);
                signOut.onSignOut();
              }}
            >
              {signOut.pending ? navCopy.signingOut : navCopy.signOut}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

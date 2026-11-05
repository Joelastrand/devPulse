"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { navCopy } from "./copy";
import { NavGroupList, type NavGroup } from "./NavGroupList";

export interface MobileDrawerProps {
  groups: NavGroup[];
  pathname: string;
  onNavigate: () => void;
  onClose: (options: { restoreFocus: boolean }) => void;
}

const TABBABLE = "a[href], button:not([disabled])";

/**
 * Mobile navigation drawer, below `md` only (docs/features/product-experience/
 * SPEC.md — Mobile navigation drawer). It is a dialog with four close paths:
 * navigation, the Lukk meny button, Escape and a click on the scrim. Focus
 * opens on the current link (else the first), is trapped while open, and is
 * returned by the caller on a non-navigation close. Scroll is locked while the
 * drawer is mounted. The slide-in is a state animation, disabled under reduced
 * motion by the global rule in app/globals.css.
 */
export function MobileDrawer({ groups, pathname, onNavigate, onClose }: MobileDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const current = panelRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const first = panelRef.current?.querySelector<HTMLElement>("a[href]");
    (current ?? first)?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose({ restoreFocus: true });
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;

    const tabbable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(TABBABLE));
    if (tabbable.length === 0) return;
    const first = tabbable[0];
    const last = tabbable[tabbable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <div
        data-testid="drawer-scrim"
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-text-primary/30 md:hidden"
        onClick={() => onClose({ restoreFocus: true })}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={navCopy.mainNavLabel}
        onKeyDown={handleKeyDown}
        className="animate-drawer-in fixed inset-y-0 left-0 z-50 flex w-[min(20rem,85vw)] flex-col gap-6 overflow-y-auto rounded-r-surface bg-sidebar p-4 text-sidebar-foreground shadow-elevated md:hidden"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-label font-semibold text-sidebar-foreground">{navCopy.brand}</p>
          <Button variant="tertiary" size="sm" onClick={() => onClose({ restoreFocus: true })}>
            <Icon icon={X} size="inline" />
            Lukk meny
          </Button>
        </div>
        <nav aria-label={navCopy.mainNavLabel} className="flex flex-col gap-6">
          <NavGroupList groups={groups} pathname={pathname} onNavigate={onNavigate} />
        </nav>
      </div>
    </>
  );
}

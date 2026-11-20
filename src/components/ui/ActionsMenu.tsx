"use client";

import { useEffect, useId, useRef, useState } from "react";
import { EllipsisVertical } from "lucide-react";
import { cx } from "./class-names";
import { Icon } from "./Icon";

export interface ActionMenuItem {
  key: string;
  label: string;
  disabled?: boolean;
  /** Destructive entries use the danger text colour. They are never the first focus target of a confirmation. */
  destructive?: boolean;
  onSelect: () => void;
}

export interface ActionsMenuProps {
  /** Accessible name of the trigger. Include the row's subject so repeated triggers stay distinguishable. */
  label: string;
  /** Visible tooltip for the icon-only trigger. */
  title: string;
  items: readonly ActionMenuItem[];
  disabled?: boolean;
  /**
   * `overlay` floats the list over the content (the default). `inline` pushes the content down instead, for a trigger
   * inside an overflow container (such as a scrolling timeline) where a floating panel would be clipped.
   */
  placement?: "overlay" | "inline";
}

/**
 * Compact actions disclosure: an icon trigger with `aria-expanded` that reveals a plain list of buttons. Escape and a
 * pointer press outside close it, and Escape returns focus to the trigger. It is deliberately not a `role="menu"`: it
 * needs no arrow-key roving focus, and Tab reaches every entry. Selecting an entry closes the panel first, so a
 * confirmation that the entry opens is not hidden behind it.
 */
export function ActionsMenu({ label, title, items, disabled = false, placement = "overlay" }: ActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = `actions-menu-${useId()}`;

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && containerRef.current?.contains(event.target)) return;
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        title={title}
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled}
        onClick={() => setOpen((previous) => !previous)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-control text-text-secondary transition-colors duration-micro ease-standard hover:bg-surface-subtle hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Icon icon={EllipsisVertical} size="action" />
      </button>
      {open && (
        <div
          id={panelId}
          className={cx(
            "flex flex-col gap-0.5 rounded-surface border border-border-subtle bg-surface p-1",
            placement === "overlay" ? "absolute right-0 z-10 mt-1 w-56 shadow-elevated" : "mt-1 w-full min-w-44",
          )}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cx(
                "rounded-control px-3 py-2 text-left text-sm transition-colors duration-micro ease-standard disabled:cursor-not-allowed disabled:opacity-50",
                item.destructive ? "text-danger-text hover:bg-danger-subtle" : "text-text-primary hover:bg-surface-subtle",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

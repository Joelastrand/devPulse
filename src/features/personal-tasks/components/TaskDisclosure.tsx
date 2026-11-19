"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

interface TaskDisclosureProps {
  /** Accessible name of the trigger (the visible content may be an icon). */
  label: string;
  triggerContent: ReactNode;
  triggerClassName?: string;
  /** Accessible name of the expanded panel. */
  panelLabel: string;
  panelClassName?: string;
  className?: string;
  /** Renders the panel content. `close` hides the panel; pass `true` to return focus to the trigger. */
  children: (close: (returnFocus: boolean) => void) => ReactNode;
}

/**
 * A button that shows or hides a panel of actions in place. The panel is part of the normal flow, not an absolute
 * popover, so the scrolling column can never clip it. Escape inside the panel closes it and returns focus to the
 * trigger. Nothing opens on hover, so every action is reachable with keyboard and touch.
 */
export function TaskDisclosure({
  label,
  triggerContent,
  triggerClassName,
  panelLabel,
  panelClassName,
  className,
  children,
}: TaskDisclosureProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerId = useId();

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) document.getElementById(triggerId)?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (open && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  }

  return (
    <div className={className} onKeyDown={handleKeyDown}>
      <button
        id={triggerId}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={
          triggerClassName ??
          "flex size-11 shrink-0 items-center justify-center rounded text-text-secondary hover:bg-surface-subtle hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        }
      >
        {triggerContent}
      </button>
      {open && (
        <div id={panelId} role="group" aria-label={panelLabel} className={panelClassName}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

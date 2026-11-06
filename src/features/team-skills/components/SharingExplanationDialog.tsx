"use client";

import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { Button } from "../../../components/ui/Button";
import { sharingExplanationCopy as copy } from "../copy";

const TABBABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])";

/**
 * Accessible explanation of per-team competence sharing (TASK-010, SPEC BR-23). Mounted only while open, so the
 * trigger is the element focus returns to. Focus moves to the close button on open, Escape and the close button
 * dismiss it, Tab is trapped inside, and page scroll is locked while it is mounted.
 */
export function SharingExplanationDialog({ teamName, onClose }: { teamName: string; onClose: () => void }) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      returnFocusTo?.focus();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-text-primary/30 p-4 sm:items-center" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-surface bg-surface-elevated p-5 shadow-elevated"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold text-text-primary">
            {copy.title}
          </h2>
          <Button type="button" variant="tertiary" size="sm" onClick={onClose}>
            {copy.close}
          </Button>
        </div>
        <p id={descriptionId} className="text-text-secondary">
          {copy.description(teamName)}
        </p>
        <ul className="list-disc pl-5 text-text-secondary">
          {copy.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

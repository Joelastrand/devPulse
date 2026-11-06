"use client";

import { Info } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "../../../components/ui/Button";
import { Icon } from "../../../components/ui/Icon";
import { ASSESSMENT_ATTRIBUTES, ASSESSMENT_ATTRIBUTE_LABELS, ASSESSMENT_VALUES, ASSESSMENT_VALUE_LABELS, type AssessmentValue } from "../domain/team-system";
import { systemsCopy } from "../copy";

const TABBABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])";

export interface ExplanationDialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Modal dialog used for every explanation in Systemoversikt. It is mounted only
 * while open, so the caller's trigger is the element focus returns to. Escape
 * and the close button both close it, Tab is trapped inside, and page scroll is
 * locked while it is mounted.
 */
export function ExplanationDialog({ title, onClose, children }: ExplanationDialogProps) {
  const titleId = useId();
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
        onKeyDown={handleKeyDown}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-surface bg-surface p-5 shadow-elevated"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-section-title font-semibold text-text-primary">
            {title}
          </h2>
          <Button type="button" variant="tertiary" size="sm" onClick={onClose}>
            {systemsCopy.explanation.close}
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Single-attribute explanation, opened from a row's information button. */
export function AttributeInfoButton({ attribute }: { attribute: (typeof ASSESSMENT_ATTRIBUTES)[number] }) {
  const [open, setOpen] = useState(false);
  const label = ASSESSMENT_ATTRIBUTE_LABELS[attribute];
  return (
    <>
      <button
        type="button"
        aria-label={systemsCopy.explanation.infoFor(label)}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-control text-text-muted hover:bg-surface-subtle hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Icon icon={Info} size="inline" />
      </button>
      {open && (
        <ExplanationDialog title={label} onClose={() => setOpen(false)}>
          <p className="text-label text-text-secondary">{systemsCopy.qualityPanel[attribute].body}</p>
        </ExplanationDialog>
      )}
    </>
  );
}

/** Shared "Forklaring" control above the matrix (reference 16): all seven attributes and the four statuses. */
export function QualityExplanation() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" size="sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <Icon icon={Info} size="inline" />
        {systemsCopy.explanation.open}
      </Button>
      {open && (
        <ExplanationDialog title={systemsCopy.explanation.title} onClose={() => setOpen(false)}>
          <p className="text-help text-text-muted">{systemsCopy.explanation.intro}</p>
          <dl className="flex flex-col gap-3">
            {ASSESSMENT_ATTRIBUTES.map((attribute) => (
              <div key={attribute}>
                <dt className="text-label font-semibold text-text-primary">{ASSESSMENT_ATTRIBUTE_LABELS[attribute]}</dt>
                <dd className="text-help text-text-secondary">{systemsCopy.qualityPanel[attribute].body}</dd>
              </div>
            ))}
          </dl>
          <div>
            <h3 className="text-label font-semibold text-text-primary">{systemsCopy.explanation.statusTitle}</h3>
            <dl className="mt-2 flex flex-col gap-2">
              {ASSESSMENT_VALUES.map((value: AssessmentValue) => (
                <div key={value} className="flex flex-col">
                  <dt className="text-label font-medium text-text-primary">{ASSESSMENT_VALUE_LABELS[value]}</dt>
                  <dd className="text-help text-text-secondary">{systemsCopy.explanation.statusHelp[value]}</dd>
                </div>
              ))}
            </dl>
          </div>
        </ExplanationDialog>
      )}
    </>
  );
}

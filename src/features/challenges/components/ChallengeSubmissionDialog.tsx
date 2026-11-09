"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "../../../components/ui/Button";
import { challengesCopy } from "../copy";
import { ChallengeSubmissionPanel } from "./ChallengeSubmissionPanel";

const TABBABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])";

export interface ChallengeSubmissionDialogProps {
  idToken: string;
  teamId: string;
  /** Forwarded to the panel: called after a successful submission so the caller re-reads the challenge list. */
  onSubmitted: () => void;
}

/**
 * The "Meld inn utfordring" action for the team overview. Opens the existing `ChallengeSubmissionPanel` in a modal, so
 * validation, the gateway call and the server route stay the only submission path. The dialog is mounted only while
 * open, so the trigger is the element focus returns to. Escape and "Avbryt"/"Lukk" close it; a click on the backdrop
 * deliberately does not, so a half-written challenge is never lost by accident.
 */
export function ChallengeSubmissionDialog({ idToken, teamId, onSubmitted }: ChallengeSubmissionDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="secondary" size="sm" aria-haspopup="dialog" aria-expanded={open} className="shrink-0" onClick={() => setOpen(true)}>
        {challengesCopy.submission.openButton}
      </Button>
      {open && (
        <SubmissionModal idToken={idToken} teamId={teamId} onSubmitted={onSubmitted} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function SubmissionModal({ idToken, teamId, onSubmitted, onClose }: ChallengeSubmissionDialogProps & { onClose: () => void }) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // The first field is the challenge text, so keyboard and screen-reader users start where the input is.
    panelRef.current?.querySelector<HTMLElement>("textarea")?.focus();
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-text-primary/30 p-4 sm:items-center">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-surface bg-surface p-5 shadow-elevated"
      >
        <h2 id={titleId} className="text-section-title font-semibold text-text-primary">
          {challengesCopy.submission.heading}
        </h2>
        <ChallengeSubmissionPanel idToken={idToken} teamId={teamId} onSubmitted={onSubmitted} onClose={onClose} />
      </div>
    </div>
  );
}

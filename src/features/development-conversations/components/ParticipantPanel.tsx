"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "../../../components/ui/Button";
import { StatusBadge, type StatusTone } from "../../../components/ui/StatusBadge";
import type { OwnerParticipantWire } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";
import { ColleaguePicker } from "./ColleaguePicker";
import { useOwnerWrite } from "./use-owner-write";
import { WriteFeedbackRegion } from "./WriteFeedbackRegion";

/** The state is always shown as text next to its tone, so the colour never carries the meaning alone. */
const PARTICIPANT_TONE: Record<OwnerParticipantWire["state"], StatusTone> = {
  none: "neutral",
  pending: "info",
  accepted: "success",
  unavailable: "warning",
};

interface ParticipantPanelProps {
  conversationId: string;
  token: string;
  completed: boolean;
  participant: OwnerParticipantWire;
  /** Must be stable: the write hook depends on it. */
  onUnauthenticated: () => void;
  /** Re-reads the authoritative conversation after a write that may have changed it. */
  onChanged: () => Promise<void>;
}

/**
 * The owner's participant controls (SPEC BR-10, BR-16, BR-18; A2.1). The participant's state is shown, and a bound participant
 * can be removed after confirmation. Without a participant, the owner chooses an eligible colleague in the picker. The server
 * decides every rule (who may be listed, and whether the invitation is accepted); a refused write is re-read.
 */
export function ParticipantPanel({ conversationId, token, completed, participant, onUnauthenticated, onChanged }: ParticipantPanelProps) {
  const { pending, feedback, feedbackRef, write } = useOwnerWrite({ token, conversationId, onUnauthenticated, onChanged });
  const [confirming, setConfirming] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLParagraphElement>(null);

  const hasParticipant = participant.state !== "none";

  // Focus moves to the confirmation text when it opens, so a keyboard user hears what will happen.
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  function cancelConfirm() {
    setConfirming(false);
    headingRef.current?.focus();
  }

  /** A form submit, so a second submit in the same tick reaches the write guard before any re-render disables the control. */
  function sendRemoval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void write({ participantMemberRef: null }, conversationsCopy.participantRemoved).then(() => setConfirming(false));
  }

  return (
    <section aria-labelledby="participant-heading" className="flex flex-col gap-4">
      <h2 id="participant-heading" ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-text-primary outline-none">
        {conversationsCopy.participantSection}
      </h2>
      <p className="max-w-prose text-sm text-text-secondary">{conversationsCopy.participantSectionHint}</p>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={PARTICIPANT_TONE[participant.state]}>{conversationsCopy.participantStateLabel[participant.state]}</StatusBadge>
          {hasParticipant && <span className="min-w-0 break-words font-medium text-text-primary">{participant.displayName ?? conversationsCopy.colleagueUnnamed}</span>}
        </div>
        {hasParticipant && <p className="text-sm text-text-secondary">{conversationsCopy.participantStateNote[participant.state]}</p>}
      </div>

      {!completed && !hasParticipant && (
        <section aria-labelledby="invite-heading" className="flex flex-col gap-3 border-t border-border-subtle pt-4">
          <h3 id="invite-heading" className="text-base font-semibold text-text-primary">
            {conversationsCopy.colleaguePickerHeading}
          </h3>
          <ColleaguePicker
            token={token}
            pending={pending}
            onUnauthenticated={onUnauthenticated}
            onInvite={(memberRef) => {
              void write({ participantMemberRef: memberRef }, conversationsCopy.inviteSent);
            }}
          />
        </section>
      )}

      {!completed && hasParticipant && !confirming && (
        <div>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => setConfirming(true)}>
            {conversationsCopy.removeButton}
          </Button>
        </div>
      )}

      {confirming && (
        <form
          noValidate
          role="group"
          aria-labelledby="participant-confirm-title"
          onSubmit={sendRemoval}
          className="flex flex-col gap-3 border-t border-border-subtle pt-4"
        >
          <p id="participant-confirm-title" ref={confirmRef} tabIndex={-1} className="font-medium text-text-primary outline-none">
            {participant.state === "pending" ? conversationsCopy.removePendingWarning : conversationsCopy.removeActiveWarning}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" size="sm" pending={pending}>
              {pending ? conversationsCopy.saving : conversationsCopy.confirmRemove}
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={cancelConfirm}>
              {conversationsCopy.cancelButton}
            </Button>
          </div>
        </form>
      )}

      <WriteFeedbackRegion feedback={feedback} regionRef={feedbackRef} />
    </section>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import type { PendingInvitationWire } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";
import { useSingleFlight } from "./use-single-flight";

interface PendingInvitationProps {
  /** The approved pending DTO only (SPEC BR-41). It has no content field, so this view cannot render conversation content. */
  invitation: PendingInvitationWire;
  /** Set by the page after an action. It states only what the server or a re-read proved. */
  notice?: string;
  /** Accepts the invitation. The page makes the one request and decides the next view. */
  onAccept: () => Promise<void>;
  /** Declines the invitation. The page makes the one request and decides the next view. */
  onDecline: () => Promise<void>;
}

/** The invitation date, as a date label. An unparsable value shows no date rather than a wrong one. */
function invitedDate(invitedAt: string): string | undefined {
  const date = new Date(invitedAt);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("nb-NO", { dateStyle: "long", timeZone: "Europe/Oslo" }).format(date);
}

/**
 * The invitee's view before acceptance (SPEC BR-14, BR-15, BR-17, BR-38, BR-41; TASK-030). It shows the team, the owner's
 * roster-level name and the invitation date, and says that no content is shown before acceptance. Accept and decline share
 * one in-flight guard, so one action sends one request and the two never overlap.
 */
export function PendingInvitation({ invitation, notice, onAccept, onDecline }: PendingInvitationProps) {
  const { pending, run } = useSingleFlight();
  const noticeRef = useRef<HTMLDivElement>(null);

  // Focus moves to a new notice, so a keyboard or screen reader user hears the outcome of the action.
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const ownerName = invitation.ownerDisplayName ?? conversationsCopy.anonymousColleague;
  const invited = invitedDate(invitation.invitedAt);

  return (
    <section aria-labelledby="pending-heading" className="flex flex-col gap-6">
      <div ref={noticeRef} tabIndex={-1} className="outline-none">
        {notice && <Alert variant="info">{notice}</Alert>}
      </div>

      <h2 id="pending-heading" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {conversationsCopy.pendingHeading}
      </h2>

      <div className="flex flex-col gap-1 text-zinc-900 dark:text-zinc-50">
        <p>{conversationsCopy.pendingOwnerLine(ownerName)}</p>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          {conversationsCopy.teamLabel}: {invitation.teamName}
        </p>
        {invited && <p className="text-sm text-zinc-700 dark:text-zinc-300">{conversationsCopy.pendingInvitedLine(invited)}</p>}
      </div>

      <p className="text-zinc-700 dark:text-zinc-300">{conversationsCopy.pendingNoContent}</p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
        {conversationsCopy.pendingCopy.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} pending={pending} onClick={() => void run(onAccept)}>
          {pending ? conversationsCopy.saving : conversationsCopy.acceptButton}
        </Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => void run(onDecline)}>
          {conversationsCopy.declineButton}
        </Button>
      </div>
    </section>
  );
}

"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { TextArea } from "../../../components/ui/TextArea";
import { saveParticipantNotes, type ParticipantConversationWire } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";
import { normalizeNote } from "../domain/text-rules";
import { participantNotesOutcome } from "./participation-outcome";
import type { WriteFeedbackState } from "./use-owner-write";
import { useSingleFlight, type SingleFlight } from "./use-single-flight";
import { WriteFeedbackRegion } from "./WriteFeedbackRegion";

interface ParticipantConversationProps {
  /** The approved participant DTO (SPEC BR-43). Owner content is read-only here. */
  conversation: ParticipantConversationWire;
  token: string;
  /** Set by the page after an action. It states only what the server or a re-read proved. */
  notice?: string;
  /** True when the re-read after a save failed. The view and the draft are kept. */
  refreshFailed: boolean;
  /** Leaves the conversation. The page makes the one request and decides the next view. */
  onLeave: () => Promise<void>;
  /** Re-reads the authoritative conversation after a notes save that may have changed it. */
  onChanged: () => Promise<void>;
  /** Must be stable: the page clears protected content when it runs. */
  onUnauthenticated: () => void;
}

/**
 * The accepted participant's view (SPEC BR-20, BR-22, BR-23, BR-43, BR-49, CL-21, CL-22; TASK-030). Every shared section is
 * shown read-only, and the owner's content is labelled as the owner's. The participant edits only their own notes, and
 * leaves through a confirmation that states the deletion. Once the conversation is completed, notes are read-only.
 */
export function ParticipantConversation({
  conversation,
  token,
  notice,
  refreshFailed,
  onLeave,
  onChanged,
  onUnauthenticated,
}: ParticipantConversationProps) {
  const flight = useSingleFlight();
  const noticeRef = useRef<HTMLDivElement>(null);
  const completed = conversation.status === "completed";

  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  return (
    <section aria-label={conversationsCopy.participantHeading} className="flex flex-col gap-10">
      <div ref={noticeRef} tabIndex={-1} className="outline-none">
        {notice && <Alert variant="info">{notice}</Alert>}
      </div>
      {refreshFailed && <Alert variant="error">{conversationsCopy.refreshFailed}</Alert>}
      {completed && <Alert variant="info">{conversationsCopy.participantCompleted}</Alert>}

      <p className="text-sm text-zinc-700 dark:text-zinc-300">{conversationsCopy.participantPrivacy}</p>

      <div className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        <p>
          {conversationsCopy.ownerNameLabel}: <span className="text-zinc-900 dark:text-zinc-50">{conversation.ownerDisplayName ?? conversationsCopy.anonymousColleague}</span>
        </p>
        <p>
          {conversationsCopy.teamLabel}: <span className="text-zinc-900 dark:text-zinc-50">{conversation.teamName}</span>
        </p>
        <p>{conversationsCopy.statusLabel[conversation.status]}</p>
      </div>

      <Section id="participant-title-heading" heading={conversationsCopy.titleSection}>
        <p className="break-words text-zinc-900 dark:text-zinc-50">{conversation.title}</p>
      </Section>

      <Section id="participant-planned-for-heading" heading={conversationsCopy.plannedForSection}>
        <p className="text-zinc-900 dark:text-zinc-50">{conversation.plannedFor ?? conversationsCopy.noPlannedFor}</p>
      </Section>

      <Section id="participant-owner-notes-heading" heading={conversationsCopy.ownerNotesSection}>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">{conversationsCopy.ownerContentNote}</p>
        <p className="whitespace-pre-line break-words text-zinc-900 dark:text-zinc-50">{conversation.ownerNotes || conversationsCopy.noOwnerNotes}</p>
      </Section>

      <Section id="participant-next-steps-heading" heading={conversationsCopy.nextStepsSection}>
        {conversation.nextSteps.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">{conversationsCopy.noNextSteps}</p>
        ) : (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-zinc-900 dark:text-zinc-50">
            {conversation.nextSteps.map((step, index) => (
              <li key={index} className="break-words">
                {step}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="participant-goals-heading" heading={conversationsCopy.sharedGoalsSection}>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">{conversationsCopy.participantSharedGoalsNote}</p>
        {conversation.sharedGoals.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">{conversationsCopy.noSharedGoals}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {conversation.sharedGoals.map((goal, index) => (
              <li key={index} className="flex flex-col gap-1 text-zinc-900 dark:text-zinc-50">
                <p className="break-words font-medium">{goal.goalTitle}</p>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{goal.areaName ?? conversationsCopy.areaUnavailable}</p>
                {goal.targetDate && (
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    {conversationsCopy.goalDateLabel}: {goal.targetDate}
                  </p>
                )}
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{conversationsCopy.goalStatusLabel[goal.status]}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="participant-own-notes-heading" heading={conversationsCopy.participantOwnNotesSection}>
        <ParticipantNotesEditor
          conversationId={conversation.conversationId}
          token={token}
          notes={conversation.participantNotes}
          completed={completed}
          flight={flight}
          onChanged={onChanged}
          onUnauthenticated={onUnauthenticated}
        />
      </Section>

      <LeaveSection flight={flight} onLeave={onLeave} />
    </section>
  );
}

/** One section with its heading. The heading is a real `h2`, so the sections can be reached by heading navigation. */
function Section({ id, heading, children }: { id: string; heading: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {heading}
      </h2>
      {children}
    </section>
  );
}

interface NotesEditorProps {
  conversationId: string;
  token: string;
  notes: string;
  completed: boolean;
  flight: SingleFlight;
  onChanged: () => Promise<void>;
  onUnauthenticated: () => void;
}

/**
 * The participant's own notes (SPEC BR-20, BR-39). One save is one request that writes `participantNotes` only. An empty
 * field clears the notes. The copy says the notes are visible to the owner and are deleted when the participant leaves.
 */
function ParticipantNotesEditor({ conversationId, token, notes, completed, flight, onChanged, onUnauthenticated }: NotesEditorProps) {
  const [draft, setDraft] = useState(notes);
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState<WriteFeedbackState>();
  const feedbackRef = useRef<HTMLDivElement>(null);

  if (completed) {
    return <p className="whitespace-pre-line break-words text-zinc-900 dark:text-zinc-50">{notes || conversationsCopy.participantNotesEmpty}</p>;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeNote(draft);
    if (!normalized.ok) {
      setError(conversationsCopy.notesInvalid);
      return;
    }
    setError(undefined);
    // The guard is taken before the first `await`, so a second submit in the same tick sends nothing.
    void flight.run(async () => {
      setFeedback(undefined);
      const outcome = participantNotesOutcome(await saveParticipantNotes(token, conversationId, { notes: normalized.text }));
      if (outcome.kind === "signed_out") {
        onUnauthenticated();
        return;
      }
      if (outcome.kind === "saved") {
        setDraft(normalized.text);
        setFeedback({ tone: "success", message: conversationsCopy.saved });
      } else {
        setFeedback({ tone: "error", message: outcome.message });
      }
      feedbackRef.current?.focus();
      if (outcome.kind === "saved" || outcome.kind === "reread") await onChanged();
    });
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3">
      <TextArea
        id="participant-notes"
        label={conversationsCopy.participantNotesLabel}
        description={conversationsCopy.participantNotesVisibility}
        rows={6}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        error={error}
      />
      <div>
        <Button type="submit" pending={flight.pending}>
          {flight.pending ? conversationsCopy.saving : conversationsCopy.saveNotes}
        </Button>
      </div>
      <WriteFeedbackRegion feedback={feedback} regionRef={feedbackRef} />
    </form>
  );
}

interface LeaveSectionProps {
  flight: SingleFlight;
  onLeave: () => Promise<void>;
}

/**
 * Leaving is always available, including after completion (SPEC BR-17). It is a destructive action, so the consequence is
 * stated and the person confirms it. Cancel sends nothing and returns focus to the leave control.
 */
function LeaveSection({ flight, onLeave }: LeaveSectionProps) {
  const [confirming, setConfirming] = useState(false);
  const leaveWrapRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  function cancel() {
    setConfirming(false);
    leaveWrapRef.current?.querySelector("button")?.focus();
  }

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void flight.run(async () => {
      await onLeave();
      setConfirming(false);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div ref={leaveWrapRef}>
        <Button type="button" variant="secondary" disabled={flight.pending} onClick={() => setConfirming(true)}>
          {conversationsCopy.leaveButton}
        </Button>
      </div>
      {confirming && (
        <form
          noValidate
          role="group"
          aria-labelledby="leave-confirm-title"
          onSubmit={confirm}
          className="flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800"
        >
          <p id="leave-confirm-title" ref={confirmRef} tabIndex={-1} className="font-medium text-zinc-900 outline-none dark:text-zinc-50">
            {conversationsCopy.leaveConfirmHeading}
          </p>
          <p className="text-sm text-zinc-900 dark:text-zinc-50">{conversationsCopy.leaveConfirmCopy}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" size="sm" pending={flight.pending}>
              {flight.pending ? conversationsCopy.saving : conversationsCopy.confirmLeave}
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={flight.pending} onClick={cancel}>
              {conversationsCopy.cancelButton}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

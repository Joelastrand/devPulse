"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { TextArea } from "../../../components/ui/TextArea";
import { TextField } from "../../../components/ui/TextField";
import type { OwnerConversationWire } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";
import { isValidPlanDate } from "../domain/plan-date";
import { NEXT_STEPS_MAX_ITEMS } from "../domain/conversation-constants";
import { normalizeNextSteps, normalizeNote, normalizeTitle } from "../domain/text-rules";
import { CompleteConversationDialog } from "./CompleteConversationDialog";
import { DeleteConversationDialog } from "./DeleteConversationDialog";
import { GoalSnapshotSelector } from "./GoalSnapshotSelector";
import { ParticipantPanel } from "./ParticipantPanel";
import { useOwnerWrite, type OwnerWriteContext } from "./use-owner-write";
import { WriteFeedbackRegion } from "./WriteFeedbackRegion";

interface OwnerConversationEditorProps {
  conversation: OwnerConversationWire;
  token: string;
  /** Must be stable: the goal selector's load effect depends on it. */
  onUnauthenticated: () => void;
  /** Re-reads the authoritative conversation. */
  onChanged: () => Promise<void>;
}

/**
 * The owner's view of one conversation (SPEC BR-19, BR-22, BR-24 to BR-28, BR-38, D2-SI-6; TASK-028). Owner sections are
 * edited one at a time, and each section saves on its own button. After completion every section is read-only, and only
 * the shared goal set can be cleared. The owner's participant controls (invite, replace, remove; TASK-029) sit above the
 * sections. Completion and delete (TASK-031) sit at the end, in their own section. Acceptance, decline and leave are
 * participant controls, and they never appear here.
 */
export function OwnerConversationEditor({ conversation, token, onUnauthenticated, onChanged }: OwnerConversationEditorProps) {
  const completed = conversation.status === "completed";
  const context: OwnerWriteContext = { token, conversationId: conversation.conversationId, onUnauthenticated, onChanged };

  return (
    <div className="flex flex-col gap-10">
      <p className="text-sm text-zinc-700 dark:text-zinc-300">{conversationsCopy.detailPrivacy}</p>
      {completed && <Alert variant="info">{conversationsCopy.detailCompleted}</Alert>}

      <ParticipantPanel
        conversationId={conversation.conversationId}
        token={token}
        teamId={conversation.teamId}
        completed={completed}
        participant={conversation.participant}
        onUnauthenticated={onUnauthenticated}
        onChanged={onChanged}
      />

      <TitleSection title={conversation.title} completed={completed} context={context} />
      <PlannedForSection plannedFor={conversation.plannedFor} completed={completed} context={context} />
      <NotesSection ownerNotes={conversation.ownerNotes} completed={completed} context={context} />
      <NextStepsSection nextSteps={conversation.nextSteps} completed={completed} context={context} />
      <ParticipantNotesSection participantNotes={conversation.participantNotes} />
      <GoalSnapshotSelector
        conversationId={conversation.conversationId}
        token={token}
        completed={completed}
        sharedGoals={conversation.sharedGoals}
        onUnauthenticated={onUnauthenticated}
        onChanged={onChanged}
      />

      <section aria-labelledby="lifecycle-heading" className="flex flex-col gap-4">
        <h2 id="lifecycle-heading" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {conversationsCopy.lifecycleSection}
        </h2>
        {!completed && (
          <CompleteConversationDialog
            conversationId={conversation.conversationId}
            token={token}
            participantState={conversation.participant.state}
            onUnauthenticated={onUnauthenticated}
            onChanged={onChanged}
          />
        )}
        <DeleteConversationDialog
          conversationId={conversation.conversationId}
          token={token}
          onUnauthenticated={onUnauthenticated}
          onChanged={onChanged}
        />
      </section>
    </div>
  );
}

/**
 * Shared frame for one section: a heading and, for a section the participant sees after acceptance, the visibility line.
 * The frame is the same in open and completed states, so the visibility copy never depends on which one applies.
 */
function Section({ id, heading, shared = true, children }: { id: string; heading: string; shared?: boolean; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {heading}
      </h2>
      {shared && <p className="text-sm text-zinc-700 dark:text-zinc-300">{conversationsCopy.visibleToParticipant}</p>}
      {children}
    </section>
  );
}

function TitleSection({ title, completed, context }: { title: string; completed: boolean; context: OwnerWriteContext }) {
  const { pending, feedback, feedbackRef, write } = useOwnerWrite(context);
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState<string>();

  if (completed) {
    return (
      <Section id="title-heading" heading={conversationsCopy.titleSection}>
        <p className="break-words text-zinc-900 dark:text-zinc-50">{title}</p>
        <WriteFeedbackRegion feedback={feedback} regionRef={feedbackRef} />
      </Section>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeTitle(draft);
    if (!normalized.ok) {
      setError(conversationsCopy.createTitleInvalid);
      return;
    }
    setError(undefined);
    void write({ title: normalized.text }, conversationsCopy.saved).then((saved) => {
      if (saved) setDraft(normalized.text);
    });
  }

  return (
    <Section id="title-heading" heading={conversationsCopy.titleSection}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3">
        <TextField
          id="owner-title"
          label={conversationsCopy.titleSection}
          autoComplete="off"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          error={error}
        />
        <div>
          <Button type="submit" pending={pending}>
            {pending ? conversationsCopy.saving : conversationsCopy.saveTitle}
          </Button>
        </div>
        <WriteFeedbackRegion feedback={feedback} regionRef={feedbackRef} />
      </form>
    </Section>
  );
}

function PlannedForSection({ plannedFor, completed, context }: { plannedFor: string | null; completed: boolean; context: OwnerWriteContext }) {
  const { pending, feedback, feedbackRef, write } = useOwnerWrite(context);
  const [draft, setDraft] = useState(plannedFor ?? "");
  const [error, setError] = useState<string>();

  if (completed) {
    return (
      <Section id="planned-for-heading" heading={conversationsCopy.plannedForSection}>
        <p className="text-zinc-900 dark:text-zinc-50">{plannedFor ?? conversationsCopy.noPlannedFor}</p>
        <WriteFeedbackRegion feedback={feedback} regionRef={feedbackRef} />
      </Section>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft !== "" && !isValidPlanDate(draft)) {
      setError(conversationsCopy.createDateInvalid);
      return;
    }
    setError(undefined);
    const plannedFor = draft === "" ? null : draft;
    void write({ plannedFor }, conversationsCopy.saved).then((saved) => {
      if (saved) setDraft(plannedFor ?? "");
    });
  }

  return (
    <Section id="planned-for-heading" heading={conversationsCopy.plannedForSection}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3">
        <TextField
          id="owner-planned-for"
          type="date"
          label={conversationsCopy.plannedForSection}
          description={conversationsCopy.plannedForClearHint}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          error={error}
        />
        <div>
          <Button type="submit" pending={pending}>
            {pending ? conversationsCopy.saving : conversationsCopy.savePlannedFor}
          </Button>
        </div>
        <WriteFeedbackRegion feedback={feedback} regionRef={feedbackRef} />
      </form>
    </Section>
  );
}

function NotesSection({ ownerNotes, completed, context }: { ownerNotes: string; completed: boolean; context: OwnerWriteContext }) {
  const { pending, feedback, feedbackRef, write } = useOwnerWrite(context);
  const [draft, setDraft] = useState(ownerNotes);
  const [error, setError] = useState<string>();

  if (completed) {
    return (
      <Section id="notes-heading" heading={conversationsCopy.notesSection}>
        <p className="whitespace-pre-line break-words text-zinc-900 dark:text-zinc-50">{ownerNotes || conversationsCopy.noNotes}</p>
        <WriteFeedbackRegion feedback={feedback} regionRef={feedbackRef} />
      </Section>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeNote(draft);
    if (!normalized.ok) {
      setError(conversationsCopy.notesInvalid);
      return;
    }
    setError(undefined);
    void write({ ownerNotes: normalized.text }, conversationsCopy.saved).then((saved) => {
      if (saved) setDraft(normalized.text);
    });
  }

  return (
    <Section id="notes-heading" heading={conversationsCopy.notesSection}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3">
        <TextArea
          id="owner-notes"
          label={conversationsCopy.notesSection}
          description={conversationsCopy.notesHint}
          rows={6}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          error={error}
        />
        <div>
          <Button type="submit" pending={pending}>
            {pending ? conversationsCopy.saving : conversationsCopy.saveNotes}
          </Button>
        </div>
        <WriteFeedbackRegion feedback={feedback} regionRef={feedbackRef} />
      </form>
    </Section>
  );
}

/**
 * Next steps are edited one per line. Blank lines are skipped, because they are not steps. Each step is then checked by the
 * same rule the server uses (BR-39), and there are at most `NEXT_STEPS_MAX_ITEMS` of them.
 */
function parseNextStepsDraft(draft: string): { ok: true; items: string[] } | { ok: false; message: string } {
  const lines = draft.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length > NEXT_STEPS_MAX_ITEMS) return { ok: false, message: conversationsCopy.nextStepsLimit };
  const normalized = normalizeNextSteps(lines);
  return normalized.ok ? { ok: true, items: normalized.items } : { ok: false, message: conversationsCopy.nextStepInvalid };
}

function NextStepsSection({ nextSteps, completed, context }: { nextSteps: string[]; completed: boolean; context: OwnerWriteContext }) {
  const { pending, feedback, feedbackRef, write } = useOwnerWrite(context);
  const [draft, setDraft] = useState(nextSteps.join("\n"));
  const [error, setError] = useState<string>();

  if (completed) {
    return (
      <Section id="next-steps-heading" heading={conversationsCopy.nextStepsSection}>
        {nextSteps.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">{conversationsCopy.noNextSteps}</p>
        ) : (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-zinc-900 dark:text-zinc-50">
            {nextSteps.map((step, index) => (
              <li key={index} className="break-words">
                {step}
              </li>
            ))}
          </ul>
        )}
        <WriteFeedbackRegion feedback={feedback} regionRef={feedbackRef} />
      </Section>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseNextStepsDraft(draft);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setError(undefined);
    void write({ nextSteps: parsed.items }, conversationsCopy.saved).then((saved) => {
      if (saved) setDraft(parsed.items.join("\n"));
    });
  }

  return (
    <Section id="next-steps-heading" heading={conversationsCopy.nextStepsSection}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3">
        <TextArea
          id="owner-next-steps"
          label={conversationsCopy.nextStepsSection}
          description={conversationsCopy.nextStepsHint}
          rows={5}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          error={error}
        />
        <div>
          <Button type="submit" pending={pending}>
            {pending ? conversationsCopy.saving : conversationsCopy.saveNextSteps}
          </Button>
        </div>
        <WriteFeedbackRegion feedback={feedback} regionRef={feedbackRef} />
      </form>
    </Section>
  );
}

/** The participant's notes, read only for the owner. The owner cannot write them (BR-20). */
function ParticipantNotesSection({ participantNotes }: { participantNotes: string }) {
  return (
    <Section id="participant-notes-heading" heading={conversationsCopy.participantNotesSection} shared={false}>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">{conversationsCopy.participantNotesHint}</p>
      <p className="whitespace-pre-line break-words text-zinc-900 dark:text-zinc-50">
        {participantNotes || conversationsCopy.noParticipantNotes}
      </p>
    </Section>
  );
}

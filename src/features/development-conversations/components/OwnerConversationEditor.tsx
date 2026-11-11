"use client";

import { ConversationSectionTabs } from "./ConversationSectionTabs";
import { useState, type FormEvent, type ReactNode } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { StatusBadge } from "../../../components/ui/StatusBadge";
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
import { EvidenceSelector } from "./EvidenceSelector";
import { ParticipantPanel } from "./ParticipantPanel";
import { useOwnerWrite, type OwnerWriteContext } from "./use-owner-write";
import { useReportUnsaved } from "./unsaved-changes";
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
 * edited one at a time, and each section saves on its own button. The sections are grouped in tabs, in this order:
 * overview, notes, participant and shared goals, and follow-up. Every tab stays mounted, so an unsaved draft survives a
 * tab switch. After completion every section is read-only, and only the shared goal set can be cleared.
 * Acceptance, decline and leave are participant controls, and they never appear here.
 */
export function OwnerConversationEditor({ conversation, token, onUnauthenticated, onChanged }: OwnerConversationEditorProps) {
  const completed = conversation.status === "completed";
  const context: OwnerWriteContext = { token, conversationId: conversation.conversationId, onUnauthenticated, onChanged };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <p className="max-w-prose text-sm text-text-secondary">{conversationsCopy.detailPrivacy}</p>
      {/* Header facts from the owner read already in hand (SPEC 10 criterion; BR-23): status, start date and participant. */}
      <div className="flex min-w-0 flex-col gap-2 text-sm text-text-muted">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusBadge>{conversationsCopy.statusLabel[conversation.status]}</StatusBadge>
          {conversation.plannedFor !== null && (
            <span className="min-w-0 break-words">
              {conversationsCopy.plannedForLabel}: {conversation.plannedFor}
            </span>
          )}
        </div>
        <p className="min-w-0 break-words">
          {conversationsCopy.participantStateLabel[conversation.participant.state]}
          {conversation.participant.state !== "none" && (
            <> · {conversation.participant.displayName ?? conversationsCopy.anonymousColleague}</>
          )}
        </p>
      </div>
      {completed && <Alert variant="info">{conversationsCopy.detailCompleted}</Alert>}

      <ConversationSectionTabs
        label={conversationsCopy.sectionTabs.label}
        tabs={[
          {
            id: "overview",
            label: conversationsCopy.sectionTabs.overview,
            children: (
              <>
                <TitleSection title={conversation.title} completed={completed} context={context} />
                <PlannedForSection plannedFor={conversation.plannedFor} completed={completed} context={context} />
                <section aria-labelledby="lifecycle-heading" className="flex flex-col gap-4">
                  <h2 id="lifecycle-heading" className="text-section-title font-semibold text-text-primary">
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
              </>
            ),
          },
          {
            id: "notes",
            label: conversationsCopy.sectionTabs.notes,
            children: (
              <>
                <NotesSection ownerNotes={conversation.ownerNotes} completed={completed} context={context} />
                <ParticipantNotesSection participantNotes={conversation.participantNotes} />
              </>
            ),
          },
          {
            id: "participants",
            label: conversationsCopy.sectionTabs.participants,
            children: (
              <>
                <ParticipantPanel
                  conversationId={conversation.conversationId}
                  token={token}
                  teamId={conversation.teamId}
                  completed={completed}
                  participant={conversation.participant}
                  onUnauthenticated={onUnauthenticated}
                  onChanged={onChanged}
                />
                <GoalSnapshotSelector
                  conversationId={conversation.conversationId}
                  token={token}
                  completed={completed}
                  sharedGoals={conversation.sharedGoals}
                  onUnauthenticated={onUnauthenticated}
                  onChanged={onChanged}
                />
                <EvidenceSelector
                  conversationId={conversation.conversationId}
                  token={token}
                  completed={completed}
                  sharedEvidence={conversation.sharedEvidence}
                  expectedUpdatedAt={conversation.updatedAt}
                  onUnauthenticated={onUnauthenticated}
                  onChanged={onChanged}
                />
              </>
            ),
          },
          {
            id: "follow-up",
            label: conversationsCopy.sectionTabs.followUp,
            children: <NextStepsSection nextSteps={conversation.nextSteps} completed={completed} context={context} />,
          },
        ]}
      />
    </div>
  );
}

/**
 * Shared frame for one section: a heading and, for a section the participant sees after acceptance, the visibility line.
 * The frame is the same in open and completed states, so the visibility copy never depends on which one applies.
 */
function Section({ id, heading, shared = true, children }: { id: string; heading: string; shared?: boolean; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-4">
      <h2 id={id} className="text-section-title font-semibold text-text-primary">
        {heading}
      </h2>
      {shared && <p className="text-sm text-text-secondary">{conversationsCopy.visibleToParticipant}</p>}
      {children}
    </section>
  );
}

/** Save row: the section's own save button, plus a visible "not saved" marker while the draft differs from the saved value. */
function SaveRow({ pending, label, dirty, pendingLabel }: { pending: boolean; label: string; dirty: boolean; pendingLabel: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" pending={pending}>
        {pending ? pendingLabel : label}
      </Button>
      {dirty && !pending && <span className="text-help text-text-secondary">{conversationsCopy.unsavedSection}</span>}
    </div>
  );
}

function TitleSection({ title, completed, context }: { title: string; completed: boolean; context: OwnerWriteContext }) {
  const { pending, feedback, feedbackRef, write } = useOwnerWrite(context);
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState<string>();
  const dirty = !completed && draft !== title;
  useReportUnsaved("title", dirty);

  if (completed) {
    return (
      <Section id="title-heading" heading={conversationsCopy.titleSection}>
        <p className="break-words text-text-primary">{title}</p>
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
        <SaveRow pending={pending} label={conversationsCopy.saveTitle} dirty={dirty} pendingLabel={conversationsCopy.saving} />
        <WriteFeedbackRegion feedback={feedback} regionRef={feedbackRef} />
      </form>
    </Section>
  );
}

function PlannedForSection({ plannedFor, completed, context }: { plannedFor: string | null; completed: boolean; context: OwnerWriteContext }) {
  const { pending, feedback, feedbackRef, write } = useOwnerWrite(context);
  const [draft, setDraft] = useState(plannedFor ?? "");
  const [error, setError] = useState<string>();
  const dirty = !completed && draft !== (plannedFor ?? "");
  useReportUnsaved("planned-for", dirty);

  if (completed) {
    return (
      <Section id="planned-for-heading" heading={conversationsCopy.plannedForSection}>
        <p className="text-text-primary">{plannedFor ?? conversationsCopy.noPlannedFor}</p>
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
    const nextPlannedFor = draft === "" ? null : draft;
    void write({ plannedFor: nextPlannedFor }, conversationsCopy.saved).then((saved) => {
      if (saved) setDraft(nextPlannedFor ?? "");
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
        <SaveRow pending={pending} label={conversationsCopy.savePlannedFor} dirty={dirty} pendingLabel={conversationsCopy.saving} />
        <WriteFeedbackRegion feedback={feedback} regionRef={feedbackRef} />
      </form>
    </Section>
  );
}

function NotesSection({ ownerNotes, completed, context }: { ownerNotes: string; completed: boolean; context: OwnerWriteContext }) {
  const { pending, feedback, feedbackRef, write } = useOwnerWrite(context);
  const [draft, setDraft] = useState(ownerNotes);
  const [error, setError] = useState<string>();
  const dirty = !completed && draft !== ownerNotes;
  useReportUnsaved("notes", dirty);

  if (completed) {
    return (
      <Section id="notes-heading" heading={conversationsCopy.notesSection}>
        <p className="whitespace-pre-line break-words text-text-primary">{ownerNotes || conversationsCopy.noNotes}</p>
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
        <SaveRow pending={pending} label={conversationsCopy.saveNotes} dirty={dirty} pendingLabel={conversationsCopy.saving} />
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
  const dirty = !completed && draft !== nextSteps.join("\n");
  useReportUnsaved("next-steps", dirty);

  if (completed) {
    return (
      <Section id="next-steps-heading" heading={conversationsCopy.nextStepsSection}>
        {nextSteps.length === 0 ? (
          <p className="text-text-secondary">{conversationsCopy.noNextSteps}</p>
        ) : (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-text-primary">
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
        <SaveRow pending={pending} label={conversationsCopy.saveNextSteps} dirty={dirty} pendingLabel={conversationsCopy.saving} />
        <WriteFeedbackRegion feedback={feedback} regionRef={feedbackRef} />
      </form>
    </Section>
  );
}

/** The participant's notes, read only for the owner. The owner cannot write them (BR-20). */
function ParticipantNotesSection({ participantNotes }: { participantNotes: string }) {
  return (
    <Section id="participant-notes-heading" heading={conversationsCopy.participantNotesSection} shared={false}>
      <p className="text-sm text-text-secondary">{conversationsCopy.participantNotesHint}</p>
      <p className="whitespace-pre-line break-words text-text-primary">
        {participantNotes || conversationsCopy.noParticipantNotes}
      </p>
    </Section>
  );
}

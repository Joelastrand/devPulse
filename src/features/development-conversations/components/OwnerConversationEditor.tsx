"use client";

import { ConversationSectionTabs } from "./ConversationSectionTabs";
import { useState, type FormEvent, type ReactNode } from "react";
import { Alert } from "../../../components/ui/Alert";
import { CollapsibleSection } from "../../../components/ui/CollapsibleSection";
import { StatusBadge } from "../../../components/ui/StatusBadge";
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
  /** Notes a participant wrote are shown whenever there is a participant or any note to read, so none is hidden by a state rule. */
  const showParticipantNotes = conversation.participant.state !== "none" || conversation.participantNotes !== "";

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* The conversation's own title is the page's primary heading (the route keeps only the small "Samtale" eyebrow). */}
      <header className="flex min-w-0 flex-col gap-2">
        <h1 className="min-w-0 break-words text-page-title font-semibold text-text-primary">{conversation.title}</h1>
        {/* Header facts from the owner read already in hand (SPEC 10 criterion; BR-23): status, start date and participant. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
          <StatusBadge>{conversationsCopy.statusLabel[conversation.status]}</StatusBadge>
          <StatusBadge>{conversationsCopy.privateConversationBadge}</StatusBadge>
          {conversation.plannedFor !== null && (
            <span className="min-w-0 break-words">
              {conversationsCopy.plannedForLabel}: {conversation.plannedFor}
            </span>
          )}
          <span className="min-w-0 break-words">
            {conversationsCopy.participantStateLabel[conversation.participant.state]}
            {conversation.participant.state !== "none" && (
              <> · {conversation.participant.displayName ?? conversationsCopy.anonymousColleague}</>
            )}
          </span>
        </div>
        {/* What the owner may change, and what the participant sees once they accept. Stated once, here. */}
        <p className="max-w-prose text-sm text-text-secondary">{conversationsCopy.detailPrivacy}</p>
      </header>
      {completed && <Alert variant="info">{conversationsCopy.detailCompleted}</Alert>}

      <ConversationSectionTabs
        label={conversationsCopy.sectionTabs.label}
        tabs={[
          {
            id: "overview",
            label: conversationsCopy.sectionTabs.overview,
            children: (
              <>
                <OverviewSummary conversation={conversation} />
                <section aria-labelledby="details-heading" className="flex min-w-0 flex-col gap-4">
                  <h2 id="details-heading" className="text-section-title font-semibold text-text-primary">
                    {conversationsCopy.detailsSection}
                  </h2>
                  {/* Title is the wider field. Both fields stretch to one height, so their labels, inputs and save rows line up. */}
                  <div className="grid min-w-0 items-stretch gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                    <TitleSection title={conversation.title} completed={completed} context={context} />
                    <PlannedForSection plannedFor={conversation.plannedFor} completed={completed} context={context} />
                  </div>
                </section>
                {/* Destructive actions sit apart from the editing sections, so they are not hit by accident. Quieter than the editing sections. */}
                <section
                  aria-labelledby="lifecycle-heading"
                  className="flex min-w-0 flex-col gap-3 rounded-surface border border-dashed border-border-subtle p-4"
                >
                  <div className="flex flex-col gap-1">
                    <h2 id="lifecycle-heading" className="text-base font-semibold text-text-primary">
                      {conversationsCopy.lifecycleSection}
                    </h2>
                    <p className="text-sm text-text-secondary">{conversationsCopy.dangerZoneHint}</p>
                  </div>
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
                {/* With no participant the writing area takes the whole width; the participant's column appears only when there is one. */}
                <div
                  className={
                    !showParticipantNotes
                      ? "flex min-w-0 flex-col gap-8"
                      : "grid min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
                  }
                >
                  <NotesSection ownerNotes={conversation.ownerNotes} completed={completed} context={context} />
                  {showParticipantNotes && <ParticipantNotesSection participantNotes={conversation.participantNotes} />}
                </div>
              </>
            ),
          },
          {
            id: "participants",
            label: conversationsCopy.sectionTabs.participants,
            children: (
              /* Three tasks: the participant (main column), what is shared (summary column, with the sharing rules once). */
              <div className="grid min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
                <div className="flex min-w-0 flex-col gap-8">
                  <div className="rounded-surface border border-border-subtle bg-surface p-5 shadow-card">
                    <ParticipantPanel
                      conversationId={conversation.conversationId}
                      token={token}
                      completed={completed}
                      participant={conversation.participant}
                      onUnauthenticated={onUnauthenticated}
                      onChanged={onChanged}
                    />
                  </div>
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
                </div>
                <SharingSummary
                  participantState={conversation.participant.state}
                  goalCount={conversation.sharedGoals.length}
                  evidenceCount={conversation.sharedEvidence.length}
                />
              </div>
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
 * The overview's status tiles and the single next action. It reads only what the owner read already carries and repeats none
 * of the header facts (status, date and participant are shown once, in the header).
 */
function OverviewSummary({ conversation }: { conversation: OwnerConversationWire }) {
  const { sharedGoals, sharedEvidence, nextSteps, participant, ownerNotes, status } = conversation;
  const tiles = [
    { label: conversationsCopy.summaryNotes, value: ownerNotes.trim() === "" ? conversationsCopy.summaryNotesEmpty : conversationsCopy.summaryNotesWritten },
    { label: conversationsCopy.summaryGoals, value: conversationsCopy.summaryCount(sharedGoals.length) },
    { label: conversationsCopy.summaryEvidence, value: conversationsCopy.summaryCount(sharedEvidence.length) },
    { label: conversationsCopy.summaryNextSteps, value: conversationsCopy.summaryCount(nextSteps.length) },
  ];
  return (
    <section aria-labelledby="overview-summary-heading" className="flex min-w-0 flex-col gap-4">
      <h2 id="overview-summary-heading" className="text-section-title font-semibold text-text-primary">
        {conversationsCopy.overviewSummaryHeading}
      </h2>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="flex min-w-0 flex-col gap-1 rounded-surface border border-border-subtle bg-surface p-4">
            <dt className="text-help text-text-muted">{tile.label}</dt>
            <dd className="min-w-0 break-words font-medium text-text-primary">{tile.value}</dd>
          </div>
        ))}
      </dl>
      <p className="max-w-prose text-sm text-text-secondary">
        <span className="font-medium text-text-primary">{conversationsCopy.nextActionHeading}: </span>
        {nextActionText(status, participant.state, sharedGoals.length, nextSteps.length)}
      </p>
    </section>
  );
}

/** Picks the one next action from the current state. The order matters: completion first, then the participant. */
function nextActionText(status: OwnerConversationWire["status"], participantState: OwnerConversationWire["participant"]["state"], goalCount: number, stepCount: number): string {
  if (status === "completed") return conversationsCopy.nextActionDone;
  if (participantState === "none") return conversationsCopy.nextActionInvite;
  if (participantState === "pending") return conversationsCopy.nextActionWaiting;
  if (goalCount === 0) return conversationsCopy.nextActionGoals;
  if (stepCount === 0) return conversationsCopy.nextActionFollowUp;
  return conversationsCopy.nextActionNone;
}

/**
 * The participants tab's secondary column: what is shared and the sharing rules, stated once. The rules sit in a disclosure, so
 * the invitation flow stays short. Counts come from the owner read already in hand.
 */
function SharingSummary({
  participantState,
  goalCount,
  evidenceCount,
}: {
  participantState: OwnerConversationWire["participant"]["state"];
  goalCount: number;
  evidenceCount: number;
}) {
  return (
    <section aria-labelledby="sharing-summary-heading" className="flex min-w-0 flex-col gap-4 rounded-surface border border-border-subtle bg-surface p-5 lg:sticky lg:top-6">
      <h2 id="sharing-summary-heading" className="text-base font-semibold text-text-primary">
        {conversationsCopy.sharingSummaryHeading}
      </h2>
      <dl className="flex flex-col gap-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-text-muted">{conversationsCopy.summaryParticipant}</dt>
          <dd>
            <StatusBadge tone={participantState === "accepted" ? "success" : participantState === "pending" ? "info" : "neutral"}>
              {conversationsCopy.participantStateLabel[participantState]}
            </StatusBadge>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-text-muted">{conversationsCopy.summaryGoals}</dt>
          <dd className="font-medium text-text-primary">{conversationsCopy.summaryCount(goalCount)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-text-muted">{conversationsCopy.summaryEvidence}</dt>
          <dd className="font-medium text-text-primary">{conversationsCopy.summaryCount(evidenceCount)}</dd>
        </div>
      </dl>
      <CollapsibleSection id="sharing-rules" title={conversationsCopy.sharingRulesTitle} headingLevel={3}>
        <ul className="list-disc flex flex-col gap-2 pl-5 text-sm text-text-secondary">
          {conversationsCopy.inviteCopy.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </CollapsibleSection>
    </section>
  );
}

/**
 * Shared frame for one section: a heading and, for a section the participant sees after acceptance, the visibility line.
 * The frame is the same in open and completed states, so the visibility copy never depends on which one applies.
 */
function Section({
  id,
  heading,
  shared = true,
  level = 2,
  children,
}: {
  id: string;
  heading: string;
  shared?: boolean;
  /** 3 when the section sits inside a labelled group, so the outline does not jump. */
  level?: 2 | 3;
  children: ReactNode;
}) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-1 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Heading id={id} className={`min-w-0 font-semibold text-text-primary ${level === 3 ? "text-base" : "text-section-title"}`}>
          {heading}
        </Heading>
        {/* One visibility badge replaces the repeated sentence. The text carries the meaning, so the tone is not the only cue. */}
        <StatusBadge tone={shared ? "info" : "neutral"}>
          {shared ? conversationsCopy.sharedBadge : conversationsCopy.privateBadge}
        </StatusBadge>
      </div>
      {children}
    </section>
  );
}

/** Save row: the section's own save button, plus a visible "not saved" marker while the draft differs from the saved value. */
function SaveRow({ pending, label, dirty, pendingLabel }: { pending: boolean; label: string; dirty: boolean; pendingLabel: string }) {
  return (
    <div className="mt-auto flex flex-wrap items-center gap-3">
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
      <Section id="title-heading" heading={conversationsCopy.titleSection} level={3}>
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
    <Section id="title-heading" heading={conversationsCopy.titleSection} level={3}>
      <form noValidate onSubmit={submit} className="flex flex-1 flex-col gap-3">
        <TextField
          id="owner-title"
          label={conversationsCopy.titleSection}
          description={conversationsCopy.titleHint}
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
      <Section id="planned-for-heading" heading={conversationsCopy.plannedForSection} level={3}>
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
    <Section id="planned-for-heading" heading={conversationsCopy.plannedForSection} level={3}>
      <form noValidate onSubmit={submit} className="flex flex-1 flex-col gap-3">
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
      <form noValidate onSubmit={submit} className="flex flex-1 flex-col gap-3">
        <TextArea
          id="owner-notes"
          label={conversationsCopy.notesSection}
          description={conversationsCopy.notesHint}
          rows={14}
          placeholder={conversationsCopy.notesPlaceholder}
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
      {/* The edit action sits at the top of the section, beside the heading, so the steps need no scrolling to reach it. */}
      <CollapsibleSection
        id="next-steps-editor"
        title={conversationsCopy.editNextSteps}
        headingLevel={3}
        defaultOpen={nextSteps.length === 0}
        lockOpen={dirty}
        summary={conversationsCopy.summaryCount(nextSteps.length)}
      >
        <form noValidate onSubmit={submit} className="flex flex-1 flex-col gap-3">
          <TextArea
            id="owner-next-steps"
            label={conversationsCopy.nextStepsSection}
            description={conversationsCopy.nextStepsHint}
            rows={8}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            error={error}
          />
          <SaveRow pending={pending} label={conversationsCopy.saveNextSteps} dirty={dirty} pendingLabel={conversationsCopy.saving} />
          <WriteFeedbackRegion feedback={feedback} regionRef={feedbackRef} />
        </form>
      </CollapsibleSection>
      {nextSteps.length === 0 ? (
        <p className="text-text-secondary">{conversationsCopy.noNextSteps}</p>
      ) : (
        <ol className="flex max-w-prose list-decimal flex-col gap-2 pl-5 text-text-primary">
          {nextSteps.map((step, index) => (
            <li key={index} className="break-words pl-1">
              {step}
            </li>
          ))}
        </ol>
      )}
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

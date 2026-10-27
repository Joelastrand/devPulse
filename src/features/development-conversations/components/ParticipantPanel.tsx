"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { LoadingState } from "../../../components/ui/LoadingState";
import { Select } from "../../../components/ui/Select";
import { fetchSelectableMembers, type OwnerParticipantWire, type SelectableMemberWire } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";
import { useOwnerWrite } from "./use-owner-write";
import { WriteFeedbackRegion } from "./WriteFeedbackRegion";

/** A teammate the owner may choose. The opaque `memberRef` stays in memory: it is never rendered or put in the DOM. */
interface Colleague {
  memberRef: string;
  label: string;
}

type ColleagueList = { phase: "loading" } | { phase: "unavailable" } | { phase: "ready"; colleagues: Colleague[]; truncated: boolean };

/** The one action awaiting confirmation. Only one is open at a time. */
type Confirming = "invite" | "replace" | "remove" | undefined;

interface ParticipantPanelProps {
  conversationId: string;
  token: string;
  teamId: string | null;
  completed: boolean;
  participant: OwnerParticipantWire;
  /** Must be stable: the colleague list effect depends on it. */
  onUnauthenticated: () => void;
  /** Re-reads the authoritative conversation after a write that may have changed it. */
  onChanged: () => Promise<void>;
}

/** The display name and ordinal, as the roadmap selector shows them. Presentation only: a name never authorizes anything. */
function colleagueLabel(member: SelectableMemberWire): string {
  const name = member.displayName ?? conversationsCopy.colleagueUnnamed;
  return member.ordinal === null ? name : `${name} (${member.ordinal})`;
}

/**
 * The owner's participant controls (SPEC BR-8, BR-10, BR-16, BR-18, BR-38; TASK-029). The owner chooses a teammate, invites
 * them, replaces them while open, or removes them. Every change is confirmed first, and the confirmation states its effect.
 * The server decides every rule: the list here only offers choices, and a refused choice is re-read, not guessed.
 */
export function ParticipantPanel({
  conversationId,
  token,
  teamId,
  completed,
  participant,
  onUnauthenticated,
  onChanged,
}: ParticipantPanelProps) {
  const [reloads, setReloads] = useState(0);
  const { pending, feedback, feedbackRef, write } = useOwnerWrite({
    token,
    conversationId,
    onUnauthenticated,
    // The colleague list is read again with the conversation, so a refused choice is replaced by the current team list.
    onChanged: async () => {
      setReloads((count) => count + 1);
      await onChanged();
    },
  });
  const [colleagues, setColleagues] = useState<ColleagueList>({ phase: "loading" });
  const [selected, setSelected] = useState("");
  const [confirming, setConfirming] = useState<Confirming>(undefined);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLParagraphElement>(null);

  // Choosing is offered only while open and with a team (BR-8, BR-16). A completed conversation loads no team list.
  const choosing = teamId !== null && !completed;
  const hasParticipant = participant.state !== "none";
  const mode = hasParticipant ? "replace" : "invite";

  // The server decides owner eligibility (SPEC Amendment 2026-10-19). A refusal of any kind is the neutral unavailable state,
  // never an empty roster, and no team id is sent: the conversation id is the only path input.
  useEffect(() => {
    if (teamId === null || completed) return;
    let current = true;
    void fetchSelectableMembers(token, conversationId).then((result) => {
      if (!current) return;
      if (result.status === "unauthenticated") {
        onUnauthenticated();
        return;
      }
      // A new list changes which index means which person, so the choice is cleared with it.
      setSelected("");
      setColleagues(
        result.status === "ok"
          ? {
              phase: "ready",
              colleagues: result.response.members
                .filter((member) => !member.isSelf)
                .map((member) => ({ memberRef: member.memberRef, label: colleagueLabel(member) })),
              truncated: result.response.truncated,
            }
          : { phase: "unavailable" },
      );
    });
    return () => {
      current = false;
    };
  }, [token, conversationId, teamId, completed, reloads, onUnauthenticated]);

  // Focus moves to the confirmation text when it opens, so a keyboard user hears what will happen.
  useEffect(() => {
    if (confirming !== undefined) confirmRef.current?.focus();
  }, [confirming]);

  const chosen: Colleague | undefined =
    colleagues.phase === "ready" && selected !== "" ? colleagues.colleagues[Number(selected)] : undefined;

  function cancelConfirm() {
    setConfirming(undefined);
    headingRef.current?.focus();
  }

  /** A form submit, so a second submit in the same tick reaches the write guard before any re-render disables the control. */
  function sendConfirmed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirming === "remove") {
      void write({ participantMemberRef: null }, conversationsCopy.participantRemoved).then(() => setConfirming(undefined));
      return;
    }
    if (!chosen) return;
    const message = confirming === "replace" ? conversationsCopy.replaceSent : conversationsCopy.inviteSent;
    void write({ participantMemberRef: chosen.memberRef }, message).then(() => setConfirming(undefined));
  }

  const confirmTitle =
    confirming === "remove"
      ? participant.state === "pending"
        ? conversationsCopy.removePendingWarning
        : conversationsCopy.removeActiveWarning
      : conversationsCopy.inviteConfirmHeading;

  return (
    <section aria-labelledby="participant-heading" className="flex flex-col gap-4">
      <h2 id="participant-heading" ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-zinc-900 outline-none dark:text-zinc-50">
        {conversationsCopy.participantSection}
      </h2>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">{conversationsCopy.participantSectionHint}</p>

      <div className="flex flex-col gap-1">
        <p className="font-medium text-zinc-900 dark:text-zinc-50">
          {conversationsCopy.participantStateLabel[participant.state]}
          {hasParticipant && <>: {participant.displayName ?? conversationsCopy.colleagueUnnamed}</>}
        </p>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">{conversationsCopy.participantStateNote[participant.state]}</p>
      </div>

      {teamId === null && participant.state === "none" && (
        <p className="text-zinc-600 dark:text-zinc-400">{conversationsCopy.noTeamForParticipant}</p>
      )}

      {choosing && confirming === undefined && (
        <div className="flex flex-col gap-3">
          {colleagues.phase === "loading" && <LoadingState label={conversationsCopy.colleagueOptionsLoading} />}
          {colleagues.phase === "unavailable" && (
            <div className="flex flex-col items-start gap-3">
              <Alert variant="error">{conversationsCopy.colleagueOptionsError}</Alert>
              <Button variant="secondary" size="sm" onClick={() => setReloads((count) => count + 1)}>
                {conversationsCopy.retryButton}
              </Button>
            </div>
          )}
          {colleagues.phase === "ready" && colleagues.colleagues.length === 0 && (
            <p className="text-zinc-600 dark:text-zinc-400">{conversationsCopy.colleagueOptionsEmpty}</p>
          )}
          {colleagues.phase === "ready" && colleagues.colleagues.length > 0 && (
            <>
              <Select
                id="participant-select"
                label={mode === "replace" ? conversationsCopy.chooseReplacement : conversationsCopy.chooseColleague}
                value={selected}
                disabled={pending}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value="">{mode === "replace" ? conversationsCopy.chooseReplacement : conversationsCopy.chooseColleague}</option>
                {colleagues.colleagues.map((colleague, index) => (
                  <option key={index} value={String(index)}>
                    {colleague.label}
                  </option>
                ))}
              </Select>
              {colleagues.truncated && <Alert variant="info">{conversationsCopy.colleagueOptionsTruncated}</Alert>}
            </>
          )}
          {colleagues.phase === "ready" && colleagues.colleagues.length > 0 && (
            <div>
              <Button type="button" disabled={!chosen || pending} onClick={() => setConfirming(mode)}>
                {mode === "replace" ? conversationsCopy.replaceButton : conversationsCopy.inviteButton}
              </Button>
            </div>
          )}
        </div>
      )}

      {hasParticipant && confirming === undefined && (
        <div>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => setConfirming("remove")}>
            {conversationsCopy.removeButton}
          </Button>
        </div>
      )}

      {confirming !== undefined && (
        <form
          noValidate
          role="group"
          aria-labelledby="participant-confirm-title"
          onSubmit={sendConfirmed}
          className="flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800"
        >
          <p id="participant-confirm-title" ref={confirmRef} tabIndex={-1} className="font-medium text-zinc-900 outline-none dark:text-zinc-50">
            {confirmTitle}
          </p>
          {confirming !== "remove" && (
            <>
              {chosen && <p className="text-sm text-zinc-900 dark:text-zinc-50">{conversationsCopy.inviteTargetLine(chosen.label)}</p>}
              {confirming === "replace" && (
                <p className="text-sm text-zinc-900 dark:text-zinc-50">
                  {participant.state === "pending" ? conversationsCopy.replacePendingWarning : conversationsCopy.replaceWarning}
                </p>
              )}
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
                {conversationsCopy.inviteCopy.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant={confirming === "remove" ? "destructive" : "primary"}
              size="sm"
              pending={pending}
              disabled={confirming !== "remove" && !chosen}
            >
              {pending
                ? conversationsCopy.saving
                : confirming === "remove"
                  ? conversationsCopy.confirmRemove
                  : confirming === "replace"
                    ? conversationsCopy.confirmReplace
                    : conversationsCopy.confirmInvite}
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

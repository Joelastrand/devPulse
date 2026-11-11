"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { LoadingState } from "../../../components/ui/LoadingState";
import { fetchEvidenceSources, type EvidenceSourceWire, type SharedEvidenceWire } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";
import { SHARED_EVIDENCE_MAX_ACHIEVEMENTS, SHARED_EVIDENCE_MAX_RESPONSIBILITIES } from "../domain/conversation-constants";
import { SharedEvidenceList } from "./SharedEvidenceList";
import { useOwnerWrite } from "./use-owner-write";
import { WriteFeedbackRegion } from "./WriteFeedbackRegion";

/** The owner's selectable records. Loaded only while the conversation is open (BR-40). */
type SourceOptions = { phase: "loading" } | { phase: "ready"; items: EvidenceSourceWire[]; truncated: boolean } | { phase: "unavailable" };

/**
 * What the owner has asked to do and is waiting to confirm. Only a replacement or clear of a non-empty shared set needs it.
 * A shared snapshot carries no source id (BR-43), so the server cannot tell which current snapshot a new selection keeps:
 * every save replaces the whole set, and the owner must see that before it is sent.
 */
type PendingReplace = { kind: "replace" } | { kind: "clear" } | null;

/** Identity of a source record. Kind plus id: titles are never identity (ids are unique per kind, titles may repeat). */
const sourceKey = (item: { kind: string; id: string }) => `${item.kind}:${item.id}`;

interface EvidenceSelectorProps {
  conversationId: string;
  token: string;
  completed: boolean;
  sharedEvidence: SharedEvidenceWire[];
  /** The conversation `updatedAt` the owner last read. The server refuses the write if the conversation changed since. */
  expectedUpdatedAt: string;
  /** Must be stable: the source list effect depends on it. */
  onUnauthenticated: () => void;
  onChanged: () => Promise<void>;
}

/**
 * The owner's evidence section (SPEC BR-40 to BR-48; TASK-008). Three areas: the currently shared snapshots, the owner's
 * private source records to choose from, and a preview of the exact replacement set. Nothing is preselected from the shared
 * set, so no title or text is ever used to infer which source a snapshot came from. Saving replaces the whole set, and a
 * replacement or clear of a non-empty shared set needs an explicit confirmation that states the counts.
 */
export function EvidenceSelector({
  conversationId,
  token,
  completed,
  sharedEvidence,
  expectedUpdatedAt,
  onUnauthenticated,
  onChanged,
}: EvidenceSelectorProps) {
  const { pending, feedback, feedbackRef, write } = useOwnerWrite({ token, conversationId, onUnauthenticated, onChanged });
  const [options, setOptions] = useState<SourceOptions>({ phase: "loading" });
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<PendingReplace>(null);
  const confirmHeadingRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (completed) return;
    let current = true;
    void fetchEvidenceSources(token, conversationId).then((result) => {
      if (!current) return;
      if (result.status === "unauthenticated") {
        onUnauthenticated();
        return;
      }
      setOptions(
        result.status === "ok"
          ? { phase: "ready", items: result.response.items, truncated: result.response.truncated }
          : { phase: "unavailable" },
      );
    });
    return () => {
      current = false;
    };
  }, [token, conversationId, completed, onUnauthenticated]);

  // Focus moves to the confirmation's consequence when it opens, so a keyboard or screen-reader user hears it first.
  useEffect(() => {
    if (confirming !== null) confirmHeadingRef.current?.focus();
  }, [confirming]);

  const ready = options.phase === "ready" ? options : null;
  const selectedItems = ready ? ready.items.filter((item) => selectedKeys.includes(sourceKey(item))) : [];
  const responsibilityCount = selectedItems.filter((item) => item.kind === "responsibility").length;
  const achievementCount = selectedItems.length - responsibilityCount;
  const hasShared = sharedEvidence.length > 0;

  function toggle(item: EvidenceSourceWire) {
    setConfirming(null);
    const key = sourceKey(item);
    if (selectedKeys.includes(key)) {
      setSelectedKeys(selectedKeys.filter((candidate) => candidate !== key));
      return;
    }
    const sameKind = selectedItems.filter((candidate) => candidate.kind === item.kind).length;
    const limit = item.kind === "responsibility" ? SHARED_EVIDENCE_MAX_RESPONSIBILITIES : SHARED_EVIDENCE_MAX_ACHIEVEMENTS;
    if (sameKind >= limit) return;
    setSelectedKeys([...selectedKeys, key]);
  }

  function replacementInput() {
    return {
      sharedEvidence: {
        responsibilityIds: selectedItems.filter((item) => item.kind === "responsibility").map((item) => item.id),
        achievementIds: selectedItems.filter((item) => item.kind === "achievement").map((item) => item.id),
      },
      expectedUpdatedAt,
    };
  }

  /** Saving with a shared set asks first. With no shared set nothing is removed, so it is sent directly. */
  function requestSave() {
    if (hasShared) {
      setConfirming({ kind: "replace" });
      return;
    }
    void sendReplacement();
  }

  async function sendReplacement() {
    const saved = await write(replacementInput(), conversationsCopy.evidenceSaved);
    setConfirming(null);
    if (saved) setSelectedKeys([]);
  }

  function sendClear() {
    void write({ sharedEvidence: { responsibilityIds: [], achievementIds: [] }, expectedUpdatedAt }, conversationsCopy.evidenceCleared).then(
      (cleared) => {
        setConfirming(null);
        if (cleared) setSelectedKeys([]);
      },
    );
  }

  /** The confirmed action. A second submit while one is in flight is refused by the write guard. */
  function sendConfirmed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirming?.kind === "clear") sendClear();
    else void sendReplacement();
  }

  const clearButton = (
    <Button
      type="button"
      variant="secondary"
      pending={pending}
      onClick={() => setConfirming({ kind: "clear" })}
      disabled={pending || confirming !== null}
    >
      {pending ? conversationsCopy.saving : conversationsCopy.clearEvidence}
    </Button>
  );

  const confirmation =
    confirming === null ? null : (
      <form
        noValidate
        role="group"
        aria-labelledby="evidence-confirm-heading"
        onSubmit={sendConfirmed}
        className="flex flex-col gap-3 rounded-md border border-border-subtle p-3"
      >
        <p id="evidence-confirm-heading" ref={confirmHeadingRef} tabIndex={-1} className="font-medium text-text-primary outline-none">
          {confirming.kind === "clear" ? conversationsCopy.evidenceClearConfirmHeading : conversationsCopy.evidenceReplaceConfirmHeading}
        </p>
        <p className="text-sm text-text-primary">
          {confirming.kind === "clear"
            ? conversationsCopy.evidenceClearConsequence(sharedEvidence.length)
            : conversationsCopy.evidenceReplaceConsequence(sharedEvidence.length, selectedItems.length)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="destructive" size="sm" pending={pending}>
            {confirming.kind === "clear" ? conversationsCopy.evidenceConfirmClear : conversationsCopy.evidenceConfirmReplace}
          </Button>
          <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => setConfirming(null)}>
            {conversationsCopy.evidenceCancelConfirm}
          </Button>
        </div>
      </form>
    );

  if (completed) {
    return (
      <section aria-labelledby="shared-evidence-heading" className="flex flex-col gap-4">
        <h2 id="shared-evidence-heading" className="text-lg font-semibold text-text-primary">
          {conversationsCopy.evidenceSection}
        </h2>
        <p className="text-sm text-text-secondary">{conversationsCopy.evidenceCompletedNote}</p>
        <SharedEvidenceList items={sharedEvidence} headingId="shared-evidence-heading" />
        {hasShared && (
          <div className="flex flex-col gap-3">
            <div>{clearButton}</div>
            {confirmation}
            <WriteFeedbackRegion feedback={feedback} regionRef={feedbackRef} />
          </div>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby="shared-evidence-heading" className="flex flex-col gap-4">
      <h2 id="shared-evidence-heading" className="text-lg font-semibold text-text-primary">
        {conversationsCopy.evidenceSection}
      </h2>
      <p className="text-sm text-text-secondary">{conversationsCopy.evidenceVisibility}</p>

      <SharedEvidenceList items={sharedEvidence} headingId="shared-evidence-heading" />

      <div className="flex flex-col gap-3">
        <h3 className="font-medium text-text-primary">{conversationsCopy.evidenceSelectorHeading}</h3>
        <p className="text-sm text-text-secondary">{conversationsCopy.evidenceSelectorCopy}</p>

        {options.phase === "loading" && <LoadingState label={conversationsCopy.evidenceLoading} />}
        {options.phase === "unavailable" && <Alert variant="error">{conversationsCopy.evidenceError}</Alert>}
        {options.phase === "ready" && options.items.length === 0 && <p className="text-text-muted">{conversationsCopy.evidenceEmpty}</p>}
        {ready !== null && ready.items.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{conversationsCopy.evidenceSelectorHeading}</legend>
            {ready.items.map((item) => {
              const key = sourceKey(item);
              const checked = selectedKeys.includes(key);
              const kindCount = selectedItems.filter((candidate) => candidate.kind === item.kind).length;
              const limit = item.kind === "responsibility" ? SHARED_EVIDENCE_MAX_RESPONSIBILITIES : SHARED_EVIDENCE_MAX_ACHIEVEMENTS;
              const atLimit = !checked && kindCount >= limit;
              return (
                <label key={key} className="flex items-start gap-2 text-sm text-text-primary">
                  <input type="checkbox" checked={checked} disabled={atLimit || pending} onChange={() => toggle(item)} className="mt-1" />
                  <span className="min-w-0 break-words">
                    <span className="text-text-muted">{conversationsCopy.evidenceKindLabel[item.kind]}: </span>
                    {item.title}
                    {item.status !== null && <span className="text-text-muted"> ({conversationsCopy.goalStatusLabel[item.status]})</span>}
                    {atLimit && <span className="block text-text-muted">{conversationsCopy.evidenceLimitReached}</span>}
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
        {ready?.truncated && <Alert variant="info">{conversationsCopy.evidenceTruncated}</Alert>}
        <p className="text-sm text-text-muted">{conversationsCopy.evidenceLimit}</p>
        {ready !== null && (
          <p className="text-sm text-text-muted" aria-live="polite">
            {conversationsCopy.evidenceCountLabel(responsibilityCount, achievementCount)}
          </p>
        )}

        {ready !== null && (
          <div className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
            <h4 className="font-medium text-text-primary">{conversationsCopy.evidencePreviewHeading}</h4>
            {selectedItems.length === 0 ? (
              <p className="text-sm text-text-muted">{conversationsCopy.evidencePreviewEmpty}</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm text-text-primary">
                {selectedItems.map((item) => (
                  <li key={sourceKey(item)} className="break-words">
                    {conversationsCopy.evidenceKindLabel[item.kind]}: {item.title}
                  </li>
                ))}
              </ul>
            )}
            {hasShared && <p className="text-sm text-text-muted">{conversationsCopy.evidencePreviewReplaces(sharedEvidence.length)}</p>}
          </div>
        )}

        {ready !== null && selectedItems.length === 0 && <p className="text-sm text-text-muted">{conversationsCopy.evidenceNeedsItem}</p>}
        <div className="flex flex-wrap gap-3">
          <Button type="button" pending={pending} disabled={ready === null || selectedItems.length === 0 || confirming !== null} onClick={requestSave}>
            {pending ? conversationsCopy.saving : conversationsCopy.saveEvidence}
          </Button>
        </div>
        {confirmation}
        {hasShared && (
          <div className="flex flex-col gap-2 border-t border-border-subtle pt-4">
            <p className="text-sm text-text-muted">{conversationsCopy.clearEvidenceCopy}</p>
            <div>{clearButton}</div>
          </div>
        )}
        <WriteFeedbackRegion feedback={feedback} regionRef={feedbackRef} />
      </div>
    </section>
  );
}

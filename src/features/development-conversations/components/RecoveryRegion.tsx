"use client";

import { useEffect, useRef, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { deleteConversation, type RecoveryItemWire } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";

interface RecoveryRegionProps {
  items: readonly RecoveryItemWire[];
  token: string;
  onUnauthenticated: () => void;
  /** Re-reads the authoritative list after a delete that may have changed it. */
  onChanged: () => Promise<void>;
}

/**
 * Owner items that cannot be shown (BR-33, D2-SI-13). Each shows neutral text and one action, permanent delete. No
 * title, status, date, team or participant exists here. A failed or uncertain delete is never retried automatically:
 * the person chooses to delete again, and the list is re-read before any new attempt.
 */
export function RecoveryRegion({ items, token, onUnauthenticated, onChanged }: RecoveryRegionProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  async function confirmDelete(conversationId: string) {
    if (deletingId !== null) return;
    setDeletingId(conversationId);
    setError(undefined);
    const result = await deleteConversation(token, conversationId);
    setDeletingId(null);

    if (result.status === "unauthenticated") {
      onUnauthenticated();
      return;
    }
    if (result.status === "deleted") {
      setConfirmingId(null);
      await onChanged();
      return;
    }
    if (result.error === "conversation_not_found") {
      setConfirmingId(null);
      setError(conversationsCopy.deleteNotFound);
      await onChanged();
      return;
    }
    // read_failed, persistence_failed and unknown: the delete may have been applied, so no claim is made either way.
    setError(conversationsCopy.deleteFailed);
  }

  return (
    <section aria-labelledby="recovery-heading" className="flex flex-col gap-2">
      <h2 id="recovery-heading" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {conversationsCopy.recoveryHeading}
      </h2>
      <p className="text-zinc-600 dark:text-zinc-400">{conversationsCopy.recoveryNotice(items.length)}</p>
      {error && <Alert variant="error">{error}</Alert>}
      <ul className="flex flex-col gap-2">
        {items.map((item, index) => (
          <RecoveryItem
            key={item.conversationId}
            index={index + 1}
            total={items.length}
            confirming={confirmingId === item.conversationId}
            deleting={deletingId === item.conversationId}
            onDelete={() => {
              setError(undefined);
              setConfirmingId(item.conversationId);
            }}
            onCancelDelete={() => setConfirmingId(null)}
            onConfirmDelete={() => void confirmDelete(item.conversationId)}
            anotherDeleting={deletingId !== null && deletingId !== item.conversationId}
          />
        ))}
      </ul>
    </section>
  );
}

interface RecoveryItemProps {
  index: number;
  total: number;
  confirming: boolean;
  deleting: boolean;
  anotherDeleting: boolean;
  onDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

function RecoveryItem({
  index,
  total,
  confirming,
  deleting,
  anotherDeleting,
  onDelete,
  onCancelDelete,
  onConfirmDelete,
}: RecoveryItemProps) {
  const message = useRef<HTMLParagraphElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    if (confirming) message.current?.focus();
    else if (wasConfirming.current) actions.current?.querySelector<HTMLButtonElement>("button")?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  return (
    <Card as="li" padding="sm" className="flex flex-col gap-2">
      <span className="text-sm text-zinc-700 dark:text-zinc-300">{conversationsCopy.recoveryItemLabel(index, total)}</span>
      {confirming ? (
        <div role="group" aria-labelledby={`recovery-confirm-${index}`} className="flex flex-col gap-2">
          <p
            id={`recovery-confirm-${index}`}
            ref={message}
            tabIndex={-1}
            className="text-sm font-medium text-zinc-900 outline-none dark:text-zinc-50"
          >
            {conversationsCopy.deleteConfirmRecovery}
          </p>
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" pending={deleting} onClick={onConfirmDelete}>
              {deleting ? conversationsCopy.deletingLabel : conversationsCopy.deleteConfirmButton}
            </Button>
            <Button variant="secondary" size="sm" disabled={deleting} onClick={onCancelDelete}>
              {conversationsCopy.keepConversation}
            </Button>
          </div>
        </div>
      ) : (
        <div ref={actions}>
          <Button
            variant="destructive"
            size="sm"
            disabled={anotherDeleting}
            aria-label={conversationsCopy.recoveryDeleteButtonName(index, total)}
            onClick={onDelete}
          >
            {conversationsCopy.deleteButton}
          </Button>
        </div>
      )}
    </Card>
  );
}

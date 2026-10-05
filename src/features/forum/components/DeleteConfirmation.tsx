"use client";

import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";

export type DeleteActionState =
  | { status: "idle" }
  | { status: "confirming" }
  | { status: "pending" }
  | { status: "error"; message: string };

export interface DeleteConfirmationProps {
  state: DeleteActionState;
  deleteLabel: string;
  deletingLabel: string;
  confirmPrompt: string;
  confirmLabel: string;
  cancelLabel: string;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  /** Disambiguates this instance's accessible button names when several render in one list (e.g. one per reply) — mirrors `AdminChallengeRow`'s `${label} – ${context}` convention. Omit for a page-level single instance (e.g. the one thread-delete action). */
  context?: string;
  /** Blocks starting a delete (e.g. while conflicting work is in flight); the confirm step itself is unaffected. */
  disabled?: boolean;
}

/**
 * Shared delete-with-confirmation affordance, reused for both a thread's and
 * a reply's delete action (docs/features/team-forum/SPEC.md — BR-40).
 * Requires an explicit confirmation click before `onConfirmDelete` fires —
 * the destructive call itself is always the caller's responsibility, never
 * triggered from this component alone.
 */
export function DeleteConfirmation({
  state,
  deleteLabel,
  deletingLabel,
  confirmPrompt,
  confirmLabel,
  cancelLabel,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  context,
  disabled = false,
}: DeleteConfirmationProps) {
  const isPending = state.status === "pending";
  const isConfirming = state.status === "confirming";
  const label = context ? `${deleteLabel} – ${context}` : deleteLabel;
  const pendingLabel = context ? `${deletingLabel} – ${context}` : deletingLabel;
  const confirmAriaLabel = context ? `${confirmLabel} – ${context}` : confirmLabel;
  const cancelAriaLabel = context ? `${cancelLabel} – ${context}` : cancelLabel;

  return (
    <div className="flex flex-col gap-2">
      {state.status === "error" && (
        <Alert variant="error" className="text-sm">
          {state.message}
        </Alert>
      )}
      {!isConfirming && (
        <Button
          variant="destructive"
          size="sm"
          className="w-fit"
          disabled={isPending || disabled}
          pending={isPending}
          aria-label={isPending ? pendingLabel : label}
          onClick={onRequestDelete}
        >
          {isPending ? deletingLabel : deleteLabel}
        </Button>
      )}
      {isConfirming && (
        <div className="flex flex-col gap-2 rounded border border-red-300 p-3 dark:border-red-900">
          <p className="text-sm text-zinc-900 dark:text-zinc-50">{confirmPrompt}</p>
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" aria-label={confirmAriaLabel} onClick={onConfirmDelete}>
              {confirmLabel}
            </Button>
            <Button variant="secondary" size="sm" aria-label={cancelAriaLabel} onClick={onCancelDelete}>
              {cancelLabel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

import { Alert } from "../../../components/ui/Alert";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { formatSurveyDate } from "../../results/domain/format-survey-date";
import type { AdminChallengeView } from "../client/admin-challenges-gateway";
import { challengesCopy } from "../copy";

export type AdminChallengeListState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; challenges: AdminChallengeView[] };

/**
 * Per-challenge admin action state — mirrors `AdminTeamDetail`'s existing
 * `SurveyRowActionState`/`RequestActionState` per-row patterns
 * (docs/features/anonymous-challenges/SPEC.md — TASK-006). Only one action
 * is ever pending for a given row at a time; `confirming_deletion` is its
 * own phase, distinct from `pending`, so the destructive delete call never
 * fires before an explicit confirmation.
 */
export type AdminChallengeRowActionState =
  | { status: "idle" }
  | { status: "confirming_deletion" }
  | { status: "pending"; action: "resolve" | "archive" | "delete" }
  | { status: "error"; message: string };

export interface AdminChallengeListProps {
  state: AdminChallengeListState;
  actions: Record<string, AdminChallengeRowActionState>;
  onResolve: (challengeId: string) => void;
  onArchive: (challengeId: string) => void;
  onRequestDelete: (challengeId: string) => void;
  onCancelDelete: (challengeId: string) => void;
  onConfirmDelete: (challengeId: string) => void;
}

/**
 * `/admin/teams/[teamId]`'s "Utfordringer" management section
 * (docs/features/anonymous-challenges/SPEC.md — BR-30, BR-31, BR-35).
 * Renders **exactly** what `listTeamChallengesForAdmin` (via
 * `fetchAdminChallenges`'s shape validation) returned — active/archived is a
 * pure presentation split of an already-fully-eligible, already-decrypted
 * response, never a privacy boundary of its own (SPEC — "UI/UX"). Lifecycle
 * action buttons are rendered purely from each row's server-provided
 * `status` (never re-derived); the server operations remain the sole
 * authorization/lifecycle authority (`.claude/rules/security.md`) — a stale
 * button click here is simply rejected/handled by the server, never
 * silently trusted.
 *
 * Never renders a submitter identity, a `uid`, or an email — no such field
 * exists on `AdminChallengeView` at all (BR-11), so there is no code path
 * here that could render one.
 */
export function AdminChallengeList({
  state,
  actions,
  onResolve,
  onArchive,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: AdminChallengeListProps) {
  if (state.status === "loading") {
    return <LoadingState label={challengesCopy.admin.loading} />;
  }

  if (state.status === "error") {
    return <Alert variant="error">{challengesCopy.admin.error}</Alert>;
  }

  if (state.challenges.length === 0) {
    return <EmptyState>{challengesCopy.admin.empty}</EmptyState>;
  }

  const activeChallenges = state.challenges.filter((challenge) => challenge.status !== "archived");
  const archivedChallenges = state.challenges.filter((challenge) => challenge.status === "archived");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {challengesCopy.admin.activeListTitle}
        </h3>
        {activeChallenges.length === 0 ? (
          <EmptyState>{challengesCopy.admin.empty}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {activeChallenges.map((challenge) => (
              <AdminChallengeRow
                key={challenge.challengeId}
                challenge={challenge}
                action={actions[challenge.challengeId] ?? { status: "idle" as const }}
                onResolve={() => onResolve(challenge.challengeId)}
                onArchive={() => onArchive(challenge.challengeId)}
                onRequestDelete={() => onRequestDelete(challenge.challengeId)}
                onCancelDelete={() => onCancelDelete(challenge.challengeId)}
                onConfirmDelete={() => onConfirmDelete(challenge.challengeId)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {challengesCopy.admin.archivedListTitle}
        </h3>
        {archivedChallenges.length === 0 ? (
          <EmptyState>{challengesCopy.admin.noArchived}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {archivedChallenges.map((challenge) => (
              <AdminChallengeRow
                key={challenge.challengeId}
                challenge={challenge}
                action={actions[challenge.challengeId] ?? { status: "idle" as const }}
                onResolve={() => onResolve(challenge.challengeId)}
                onArchive={() => onArchive(challenge.challengeId)}
                onRequestDelete={() => onRequestDelete(challenge.challengeId)}
                onCancelDelete={() => onCancelDelete(challenge.challengeId)}
                onConfirmDelete={() => onConfirmDelete(challenge.challengeId)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface AdminChallengeRowProps {
  challenge: AdminChallengeView;
  action: AdminChallengeRowActionState;
  onResolve: () => void;
  onArchive: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

const ROW_LABEL_MAX_LENGTH = 40;

/**
 * A short, non-sensitive row context for disambiguating this row's action
 * buttons' accessible names in a multi-row list (mirrors `AdminTeamDetail`'s
 * `${label} – ${displayName}` convention for survey rows, which uses each
 * survey's own title). A challenge has no title, so its own already-visible
 * text (BR-34 — content is individually visible to this viewer already; only
 * *submitter identity* is the guarantee this feature makes, never content
 * secrecy) stands in, truncated so the accessible name stays concise.
 */
function rowLabel(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > ROW_LABEL_MAX_LENGTH
    ? `${trimmed.slice(0, ROW_LABEL_MAX_LENGTH).trimEnd()}…`
    : trimmed;
}

/**
 * One challenge row. Action buttons are rendered exactly per the lifecycle
 * table below — no "reopen"/"unresolve"/"unarchive" action exists anywhere
 * (SPEC — "Lifecycle", BR-19):
 *   - `open`: Marker som løst, Arkiver, Slett
 *   - `resolved`: Arkiver, Slett
 *   - `archived`: Slett only
 */
function AdminChallengeRow({
  challenge,
  action,
  onResolve,
  onArchive,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: AdminChallengeRowProps) {
  const isPending = action.status === "pending";
  const isResolvePending = action.status === "pending" && action.action === "resolve";
  const isArchivePending = action.status === "pending" && action.action === "archive";
  const isDeletePending = action.status === "pending" && action.action === "delete";
  const isConfirmingDeletion = action.status === "confirming_deletion";
  const label = rowLabel(challenge.text);

  return (
    <Card as="li" variant="bordered" padding="sm" className="flex flex-col gap-2">
      <p className="whitespace-pre-wrap break-words text-zinc-900 dark:text-zinc-50">{challenge.text}</p>
      <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
        <Badge>{challengesCopy.admin.statusLabels[challenge.status]}</Badge>
        <span>{formatSurveyDate(new Date(challenge.submittedAt))}</span>
      </p>
      {action.status === "error" && (
        <Alert variant="error" className="text-sm">
          {action.message}
        </Alert>
      )}
      {!isConfirmingDeletion && (
        <div className="flex flex-wrap gap-2">
          {challenge.status === "open" && (
            <Button
              variant="secondary"
              size="sm"
              disabled={isPending}
              pending={isResolvePending}
              aria-label={`${isResolvePending ? challengesCopy.admin.resolvingButton : challengesCopy.admin.resolveButton} – ${label}`}
              onClick={onResolve}
            >
              {isResolvePending ? challengesCopy.admin.resolvingButton : challengesCopy.admin.resolveButton}
            </Button>
          )}
          {challenge.status !== "archived" && (
            <Button
              variant="secondary"
              size="sm"
              disabled={isPending}
              pending={isArchivePending}
              aria-label={`${isArchivePending ? challengesCopy.admin.archivingButton : challengesCopy.admin.archiveButton} – ${label}`}
              onClick={onArchive}
            >
              {isArchivePending ? challengesCopy.admin.archivingButton : challengesCopy.admin.archiveButton}
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            disabled={isPending}
            pending={isDeletePending}
            aria-label={`${isDeletePending ? challengesCopy.admin.deletingButton : challengesCopy.admin.deleteButton} – ${label}`}
            onClick={onRequestDelete}
          >
            {isDeletePending ? challengesCopy.admin.deletingButton : challengesCopy.admin.deleteButton}
          </Button>
        </div>
      )}
      {isConfirmingDeletion && (
        <div className="flex flex-col gap-2 rounded border border-red-300 p-3 dark:border-red-900">
          <p className="text-sm text-zinc-900 dark:text-zinc-50">{challengesCopy.admin.deleteConfirmPrompt}</p>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              aria-label={`${challengesCopy.admin.deleteConfirmButton} – ${label}`}
              onClick={onConfirmDelete}
            >
              {challengesCopy.admin.deleteConfirmButton}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              aria-label={`${challengesCopy.admin.deleteCancelButton} – ${label}`}
              onClick={onCancelDelete}
            >
              {challengesCopy.admin.deleteCancelButton}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

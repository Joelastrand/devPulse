"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { createGoal, deleteGoal, fetchGoals, updateGoal, type GoalMutationError } from "../client/goals-gateway";
import { goalsCopy } from "../copy";
import type { GoalDto, GoalListResponse, GoalStatus } from "../domain/goal";
import { DeleteConfirmation } from "./DeleteConfirmation";
import { GoalForm, type GoalFormSubmit } from "./GoalForm";

type ViewState =
  | { phase: "loading" }
  | { phase: "signed_out" }
  | { phase: "load_error"; token: string; generation: number }
  | { phase: "ready"; data: GoalListResponse; token: string; generation: number };

/**
 * The signed-in person's own goals (docs/features/personal-development-goals/SPEC.md — BR-48 states 1–5, 7–10).
 * One `GET /api/me/goals` per auth state; the server order (BR-31) is rendered as given. Every successful
 * mutation refetches that canonical `GET` (TASK-013) instead of patching local state. Goals are private to
 * the owner: nothing here offers any other person access.
 */
/**
 * `initialTreeId` (role-profiles "Opprett mål", PG-11) opens the create form once, with that tree preselected when it is
 * an option. Nothing is created until an explicit submit.
 */
export function GoalsPage({ initialTreeId }: { initialTreeId?: string } = {}) {
  const [state, setState] = useState<ViewState>({ phase: "loading" });

  const { isCurrentGeneration } = useAuthGatedResource((token, generation) => {
    if (!token) {
      setState({ phase: "signed_out" });
      return;
    }
    setState({ phase: "loading" });
    void load(token, generation);
  });

  async function load(token: string, generation: number) {
    const result = await fetchGoals(token);
    if (!isCurrentGeneration(generation)) return;
    if (result.status === "unauthenticated") {
      setState({ phase: "signed_out" });
    } else if (result.status !== "ok") {
      setState({ phase: "load_error", token, generation });
    } else {
      setState({ phase: "ready", data: result.response, token, generation });
    }
  }

  if (state.phase === "loading") {
    return <LoadingState label={goalsCopy.loading} />;
  }

  if (state.phase === "signed_out") {
    return (
      <p className="text-zinc-600 dark:text-zinc-400">
        <Link href="/sign-in" className="font-medium text-zinc-900 underline dark:text-zinc-50">
          {goalsCopy.signInLink}
        </Link>{" "}
        {goalsCopy.signInPrompt}
      </p>
    );
  }

  if (state.phase === "load_error") {
    const { token, generation } = state;
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="error">{goalsCopy.loadError}</Alert>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setState({ phase: "loading" });
            void load(token, generation);
          }}
        >
          {goalsCopy.retryButton}
        </Button>
      </div>
    );
  }

  const { data, token, generation } = state;
  return (
    <ReadyView
      data={data}
      token={token}
      initialTreeId={initialTreeId}
      onUnauthenticated={() => setState({ phase: "signed_out" })}
      onChanged={() => load(token, generation)}
    />
  );
}

/** User-facing text for a mutation failure. `persistence_failed` and `unknown` never claim the write did not happen (BR-23). */
function mutationMessage(error: GoalMutationError): string {
  switch (error) {
    case "invalid_title":
      return goalsCopy.invalidTitle;
    case "invalid_target_date":
      return goalsCopy.invalidTargetDate;
    case "skill_not_found":
      return goalsCopy.skillNotFound;
    case "goal_not_found":
      return goalsCopy.goalNotFound;
    case "goal_limit":
      return goalsCopy.goalLimit;
    case "clock_regressed":
      return goalsCopy.serverFailure;
    case "invalid_request":
      return goalsCopy.invalidRequest;
    case "persistence_failed":
    case "unknown":
      return goalsCopy.outcomeUnknown;
  }
}

type OpenForm = { kind: "create" } | { kind: "edit"; goalId: string } | null;
/** The one open delete confirmation: a valid goal or a recovery item (BR-52, BR-61). */
type DeleteTarget = { kind: "goal" | "recovery"; goalId: string } | null;
type MutationOutcome<E> = { status: "ok" | "unauthenticated" } | { status: "error"; error: E };
type LifecycleState = { pending: true } | { pending: false; error: string };

interface ReadyViewProps {
  data: GoalListResponse;
  token: string;
  /** The create-form preselection from the page's `treeId` parameter; create mode only. */
  initialTreeId?: string;
  onUnauthenticated: () => void;
  /** Refetches the canonical GET after a successful mutation. */
  onChanged: () => Promise<void>;
}

function ReadyView({ data, token, initialTreeId, onUnauthenticated, onChanged }: ReadyViewProps) {
  const [openForm, setOpenForm] = useState<OpenForm>(initialTreeId !== undefined ? { kind: "create" } : null);
  const [lifecycle, setLifecycle] = useState<Record<string, LifecycleState>>({});
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const active = data.goals.filter((goal) => goal.status === "active");
  const completed = data.goals.filter((goal) => goal.status === "completed");
  const empty = data.goals.length === 0 && data.recoveryItems.length === 0;

  /** Runs one mutation. Resolves to an error message, or `undefined` once the change succeeded and was refetched. */
  async function mutate<E>(
    call: () => Promise<MutationOutcome<E>>,
    messageFor: (error: E) => string,
  ): Promise<string | undefined> {
    const result = await call();
    if (result.status === "unauthenticated") {
      onUnauthenticated();
      return undefined;
    }
    if (result.status === "error") return messageFor(result.error);
    await onChanged();
    return undefined;
  }

  async function handleCreate(submit: GoalFormSubmit) {
    if (submit.mode !== "create") return undefined;
    const message = await mutate(() => createGoal(token, submit.input), mutationMessage);
    if (message === undefined) setOpenForm(null);
    return message;
  }

  async function handleEdit(goalId: string, submit: GoalFormSubmit) {
    if (submit.mode !== "edit") return undefined;
    const message = await mutate(() => updateGoal(token, goalId, submit.input), mutationMessage);
    if (message === undefined) setOpenForm(null);
    return message;
  }

  async function changeStatus(goalId: string, status: GoalStatus) {
    setLifecycle((current) => ({ ...current, [goalId]: { pending: true } }));
    const message = await mutate(() => updateGoal(token, goalId, { status }), mutationMessage);
    setLifecycle((current) => {
      const rest = { ...current };
      delete rest[goalId];
      return message === undefined ? rest : { ...rest, [goalId]: { pending: false, error: message } };
    });
  }

  /** Permanent delete; the canonical refetch decides what is shown afterwards, nothing is removed optimistically. */
  async function handleDelete(target: NonNullable<DeleteTarget>) {
    const message = await mutate(
      () => deleteGoal(token, target.goalId),
      () => goalsCopy.deleteFailed,
    );
    if (message === undefined) {
      setDeleteTarget((current) => (current?.goalId === target.goalId ? null : current));
    }
    return message;
  }

  const goalItem = (goal: GoalDto) => (
    <GoalItem
      key={goal.id}
      goal={goal}
      skillOptions={data.skillOptions}
      editing={openForm?.kind === "edit" && openForm.goalId === goal.id}
      lifecycle={lifecycle[goal.id]}
      confirmingDelete={deleteTarget?.kind === "goal" && deleteTarget.goalId === goal.id}
      onEdit={() => {
        setDeleteTarget(null);
        setOpenForm({ kind: "edit", goalId: goal.id });
      }}
      onDelete={() => setDeleteTarget({ kind: "goal", goalId: goal.id })}
      onCancelDelete={() => setDeleteTarget(null)}
      onConfirmDelete={() => handleDelete({ kind: "goal", goalId: goal.id })}
      onCancelEdit={() => setOpenForm(null)}
      onSubmitEdit={(submit) => handleEdit(goal.id, submit)}
      onChangeStatus={(status) => void changeStatus(goal.id, status)}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-zinc-700 dark:text-zinc-300">{goalsCopy.privacyNotice}</p>

      {data.truncated && <Alert variant="info">{goalsCopy.truncatedNotice}</Alert>}
      {data.skillOptionsTruncated && <Alert variant="info">{goalsCopy.skillOptionsTruncatedNotice}</Alert>}

      {empty && <EmptyState>{goalsCopy.empty}</EmptyState>}

      <CreateGoalEntry
        open={openForm?.kind === "create"}
        onToggle={() => setOpenForm((current) => (current?.kind === "create" ? null : { kind: "create" }))}
        skillOptions={data.skillOptions}
        initialTreeId={initialTreeId}
        onSubmit={handleCreate}
      />

      {data.goals.length > 0 && (
        <section aria-labelledby="active-goals-heading" className="flex flex-col gap-3">
          <h2 id="active-goals-heading" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {goalsCopy.activeHeading}
          </h2>
          {active.length === 0 ? (
            <p className="text-zinc-600 dark:text-zinc-400">{goalsCopy.noActiveGoals}</p>
          ) : (
            <ul className="flex flex-col gap-2">{active.map(goalItem)}</ul>
          )}
        </section>
      )}

      {completed.length > 0 && (
        <details>
          <summary className="cursor-pointer text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {goalsCopy.completedSummary(completed.length)}
          </summary>
          <ul className="mt-3 flex flex-col gap-2">{completed.map(goalItem)}</ul>
        </details>
      )}

      {data.recoveryItems.length > 0 && (
        <section aria-labelledby="recovery-heading" className="flex flex-col gap-2">
          <h2 id="recovery-heading" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {goalsCopy.recoveryHeading}
          </h2>
          <p className="text-zinc-600 dark:text-zinc-400">{goalsCopy.recoveryNotice(data.recoveryItems.length)}</p>
          <ul className="flex flex-col gap-2">
            {data.recoveryItems.map((item, index) => (
              <RecoveryItem
                key={item.goalId}
                index={index + 1}
                total={data.recoveryItems.length}
                confirming={deleteTarget?.kind === "recovery" && deleteTarget.goalId === item.goalId}
                onDelete={() => setDeleteTarget({ kind: "recovery", goalId: item.goalId })}
                onCancelDelete={() => setDeleteTarget(null)}
                onConfirmDelete={() => handleDelete({ kind: "recovery", goalId: item.goalId })}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * The page-level create affordance (BR-48 states 2 and 4), shown in every ready state so a person who already
 * has goals (up to the limit) can still create one. Its region holds the real form while open; only one form
 * is open at a time.
 */
function CreateGoalEntry({
  open,
  onToggle,
  skillOptions,
  initialTreeId,
  onSubmit,
}: {
  open: boolean;
  onToggle: () => void;
  skillOptions: GoalListResponse["skillOptions"];
  initialTreeId?: string;
  onSubmit: (submit: GoalFormSubmit) => Promise<string | undefined>;
}) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open]);

  return (
    <div className="flex flex-col items-start gap-3">
      <Button aria-expanded={open} aria-controls="create-goal-region" onClick={onToggle}>
        {goalsCopy.createButton}
      </Button>
      <section id="create-goal-region" hidden={!open} aria-labelledby="create-goal-heading" className="w-full max-w-xl">
        <h2
          id="create-goal-heading"
          ref={heading}
          tabIndex={-1}
          className="mb-3 text-lg font-semibold text-zinc-900 outline-none dark:text-zinc-50"
        >
          {goalsCopy.createHeading}
        </h2>
        {open && (
          <GoalForm
            skillOptions={skillOptions}
            initialTreeId={initialTreeId}
            onSubmit={onSubmit}
            onCancel={onToggle}
          />
        )}
      </section>
    </div>
  );
}

interface GoalItemProps {
  goal: GoalDto;
  skillOptions: GoalListResponse["skillOptions"];
  editing: boolean;
  lifecycle: LifecycleState | undefined;
  confirmingDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => Promise<string | undefined>;
  onCancelEdit: () => void;
  onSubmitEdit: (submit: GoalFormSubmit) => Promise<string | undefined>;
  onChangeStatus: (status: GoalStatus) => void;
}

function GoalItem({
  goal,
  skillOptions,
  editing,
  lifecycle,
  confirmingDelete,
  onEdit,
  onDelete,
  onCancelDelete,
  onConfirmDelete,
  onCancelEdit,
  onSubmitEdit,
  onChangeStatus,
}: GoalItemProps) {
  const editHeading = useRef<HTMLHeadingElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const wasEditing = useRef(false);

  const wasConfirming = useRef(false);

  useEffect(() => {
    if (editing) editHeading.current?.focus();
    else if (wasEditing.current) actions.current?.querySelector<HTMLButtonElement>("button")?.focus();
    wasEditing.current = editing;
  }, [editing]);

  useEffect(() => {
    if (!confirmingDelete && wasConfirming.current) {
      actions.current?.querySelector<HTMLButtonElement>("[data-delete-trigger]")?.focus();
    }
    wasConfirming.current = confirmingDelete;
  }, [confirmingDelete]);

  const pending = lifecycle?.pending === true;

  if (editing) {
    return (
      <Card as="li" padding="sm" className="flex flex-col gap-3">
        <h3 ref={editHeading} tabIndex={-1} className="font-semibold text-zinc-900 outline-none dark:text-zinc-50">
          {goalsCopy.editHeading}
        </h3>
        <GoalForm goal={goal} skillOptions={skillOptions} onSubmit={onSubmitEdit} onCancel={onCancelEdit} />
      </Card>
    );
  }

  return (
    <Card as="li" padding="sm" className="flex flex-col gap-1">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="min-w-0 break-words font-medium text-zinc-900 dark:text-zinc-50">{goal.title}</span>
        <Badge>{goal.status === "completed" ? goalsCopy.statusCompleted : goalsCopy.statusActive}</Badge>
      </div>
      {goal.treeId !== null && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {goal.areaAvailable ? `${goalsCopy.areaLabel}: ${goal.areaName}` : goalsCopy.areaUnavailable}
        </p>
      )}
      {goal.targetDate !== null && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {goalsCopy.targetDateLabel}: {goal.targetDate}
        </p>
      )}
      {confirmingDelete ? (
        <DeleteConfirmation
          message={goalsCopy.deleteConfirmGoal(goal.title)}
          onConfirm={onConfirmDelete}
          onCancel={onCancelDelete}
        />
      ) : (
        <div ref={actions} className="mt-2 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" aria-label={goalsCopy.editButtonName(goal.title)} onClick={onEdit}>
            {goalsCopy.editButton}
          </Button>
          {goal.status === "active" ? (
            <Button
              variant="secondary"
              size="sm"
              pending={pending}
              aria-label={goalsCopy.completeButtonName(goal.title)}
              onClick={() => onChangeStatus("completed")}
            >
              {goalsCopy.completeButton}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              pending={pending}
              aria-label={goalsCopy.reopenButtonName(goal.title)}
              onClick={() => onChangeStatus("active")}
            >
              {goalsCopy.reopenButton}
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            data-delete-trigger
            disabled={pending}
            aria-label={goalsCopy.deleteButtonName(goal.title)}
            onClick={onDelete}
          >
            {goalsCopy.deleteButton}
          </Button>
        </div>
      )}
      {lifecycle?.pending === false && <Alert variant="error">{lifecycle.error}</Alert>}
    </Card>
  );
}

interface RecoveryItemProps {
  index: number;
  total: number;
  confirming: boolean;
  onDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => Promise<string | undefined>;
}

/** A goal that cannot be shown (BR-61): neutral text and exactly one action, permanent delete. No stored content exists here. */
function RecoveryItem({ index, total, confirming, onDelete, onCancelDelete, onConfirmDelete }: RecoveryItemProps) {
  const actions = useRef<HTMLDivElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    if (!confirming && wasConfirming.current) actions.current?.querySelector<HTMLButtonElement>("button")?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  return (
    <Card as="li" padding="sm" className="flex flex-col gap-2">
      <span className="text-sm text-zinc-700 dark:text-zinc-300">{goalsCopy.recoveryItemLabel(index, total)}</span>
      {confirming ? (
        <DeleteConfirmation message={goalsCopy.deleteConfirmRecovery} onConfirm={onConfirmDelete} onCancel={onCancelDelete} />
      ) : (
        <div ref={actions}>
          <Button
            variant="destructive"
            size="sm"
            aria-label={goalsCopy.recoveryDeleteButtonName(index, total)}
            onClick={onDelete}
          >
            {goalsCopy.deleteButton}
          </Button>
        </div>
      )}
    </Card>
  );
}

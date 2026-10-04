"use client";

import { useEffect, useRef, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Select } from "../../../components/ui/Select";
import { TextField } from "../../../components/ui/TextField";
import { createRoadmapItem, updateRoadmapItem, type RoadmapMutationError } from "../client/roadmap-gateway";
import { roadmapCopy } from "../copy";
import {
  KEEP_OWNER,
  buildCreateBody,
  buildPatchBody,
  datesInOrder,
  forwardTargetOptions,
  initialOwnerValue,
  type ExistingPlanValues,
  type PlanFormValues,
} from "../domain/roadmap-form";
import { ROADMAP_PRIORITIES, ROADMAP_STATUSES } from "../domain/roadmap-item";
import type { RoadmapItemView } from "../server/list-roadmap-items";
import type { PlanningActions, PlanningArea } from "./RoadmapPlanning";
import { RoadmapPlanSummary, formatOwnerName } from "./RoadmapPlanSummary";

type Notice = { variant: "info" | "error"; text: string; reload?: boolean };

/** Errors that mean the page's picture is stale: the form closes and the canonical state is refetched. */
const STALE_ERRORS: readonly RoadmapMutationError[] = [
  "team_disabled",
  "forbidden",
  "unauthenticated",
  "not_tracked",
  "tree_not_found",
  "archived",
  "not_found",
];

function errorText(error: RoadmapMutationError): string {
  const { errors } = roadmapCopy;
  switch (error) {
    case "team_disabled":
      return errors.teamDisabled;
    case "forbidden":
    case "unauthenticated":
      return errors.forbidden;
    case "target_not_ahead":
      return errors.targetNotAhead;
    case "invalid_owner":
      return errors.invalidOwner;
    case "not_tracked":
      return errors.notTracked;
    case "tree_not_found":
      return errors.treeNotFound;
    case "plan_archived":
      return errors.planArchived;
    case "archived":
      return errors.archived;
    case "not_found":
      return errors.notFound;
    case "persistence_failed":
      return errors.persistenceFailed;
    case "request_failed":
      return errors.requestFailed;
    default:
      return errors.invalidInput;
  }
}

/**
 * Plan summary plus the inline planning controls of one Kompetanseområde
 * (docs/features/team-skill-planning/SPEC.md — BR-31, BR-33). Controls exist
 * only when the server-provided `canEdit` is true (a UI affordance, never
 * authorization). Plan existence comes from the fetched state passed in, so a
 * completed plan hidden behind "Fullførte" never makes the area look unplanned.
 * No optimistic update: every successful write is followed by the canonical
 * refetch, and a failed refetch is reported separately from the write.
 */
export function AreaPlanEditor({
  area,
  plan,
  canEdit,
  actions,
  targetLocked = false,
  embedded = false,
}: {
  area: PlanningArea;
  plan: RoadmapItemView | undefined;
  canEdit: boolean;
  actions: PlanningActions;
  /** Untracked area (D13): the target is shown read-only and is never part of a write. */
  targetLocked?: boolean;
  /**
   * Controls only, for a host that already presents the plan (Roadmap page card/row): no summary and
   * no completed disclosure; the edit button stays visible as the disclosure trigger
   * (`aria-expanded`/`aria-controls`) and regains focus when the form closes.
   */
  embedded?: boolean;
}) {
  const [formOpen, setFormOpen] = useState(false);
  // The shared Button primitive takes no ref; the trigger is found through its wrapper.
  const triggerRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (embedded && wasOpenRef.current && !formOpen) triggerRef.current?.querySelector("button")?.focus();
    wasOpenRef.current = formOpen;
  }, [embedded, formOpen]);
  const formRegionId = `plan-editor-${area.treeId}`;
  const [completedOpen, setCompletedOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [restoring, setRestoring] = useState(false);
  const restoringRef = useRef(false);

  function openForm() {
    setNotice(null);
    actions.loadOwners();
    setFormOpen(true);
  }

  /** GET-only: a failed reload keeps the current notice (and its reload action) in place. */
  async function reloadPlans() {
    if (await actions.refresh()) setNotice(null);
  }

  /** Called by the form after a successful write: the canonical refetch has already been attempted. */
  function handleSaved(refreshed: boolean) {
    setFormOpen(false);
    setNotice(
      refreshed ? null : { variant: "info", text: roadmapCopy.notices.savedRefreshFailed, reload: true },
    );
  }

  function handleStale(text: string, variant: Notice["variant"], refreshed: boolean) {
    setFormOpen(false);
    setNotice({ variant, text, reload: !refreshed });
  }

  async function restore() {
    if (restoringRef.current) return;
    restoringRef.current = true;
    setRestoring(true);
    setNotice(null);
    const result = await updateRoadmapItem(actions.token, actions.teamId, area.treeId, { archived: false });
    if (result.ok) {
      const refreshed = await actions.refresh();
      setFormOpen(false);
      setNotice(refreshed ? null : { variant: "info", text: roadmapCopy.notices.savedRefreshFailed, reload: true });
    } else {
      if (result.error !== "persistence_failed") await actions.refresh();
      setNotice({ variant: "error", text: errorText(result.error) });
    }
    restoringRef.current = false;
    setRestoring(false);
  }

  const restoreLabel = restoring ? roadmapCopy.form.restoring : roadmapCopy.form.restorePlan;
  const noticeView = notice && (
    <div className="flex flex-col items-start gap-2">
      <Alert variant={notice.variant} className="text-sm">
        {notice.text}
      </Alert>
      {notice.reload && (
        <Button variant="secondary" size="sm" onClick={reloadPlans}>
          {roadmapCopy.form.reloadPlans}
        </Button>
      )}
    </div>
  );

  if (!plan) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{roadmapCopy.noPlan}</p>
        {noticeView}
        {canEdit && !formOpen && (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${roadmapCopy.form.plan} – ${area.name}`}
            onClick={openForm}
          >
            {roadmapCopy.form.plan}
          </Button>
        )}
        {canEdit && formOpen && (
          <PlanForm
            key="create"
            area={area}
            plan={undefined}
            actions={actions}
            restoring={restoring}
            onRestore={restore}
            onSaved={handleSaved}
            onStale={handleStale}
            onCancel={() => setFormOpen(false)}
          />
        )}
      </div>
    );
  }

  const editForm = (
    <PlanForm
      key="edit"
      area={area}
      plan={plan}
      actions={actions}
      targetLocked={targetLocked}
      restoring={restoring}
      onRestore={restore}
      onSaved={handleSaved}
      onStale={handleStale}
      onCancel={() => setFormOpen(false)}
    />
  );
  const summary = embedded ? null : <RoadmapPlanSummary plan={plan} />;
  const completedHidden = !embedded && plan.status === "completed" && !completedOpen;

  return (
    <div className="flex flex-col items-start gap-2">
      {!embedded && plan.status === "completed" && (
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={completedOpen}
          onClick={() => setCompletedOpen(!completedOpen)}
        >
          {roadmapCopy.toggles.completed}
        </Button>
      )}
      {!completedHidden && summary}
      {noticeView}
      {!completedHidden && canEdit && plan.archived && (
        <Button
          variant="secondary"
          size="sm"
          pending={restoring}
          aria-label={`${restoreLabel} – ${area.name}`}
          onClick={restore}
        >
          {restoreLabel}
        </Button>
      )}
      {!completedHidden && canEdit && !plan.archived && (embedded || !formOpen) && (
        <div ref={triggerRef} className="contents">
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${roadmapCopy.form.edit} – ${area.name}`}
            aria-expanded={embedded ? formOpen : undefined}
            aria-controls={embedded ? formRegionId : undefined}
            onClick={openForm}
          >
            {roadmapCopy.form.edit}
          </Button>
        </div>
      )}
      {!completedHidden && canEdit && !plan.archived && embedded && <div id={formRegionId} hidden={!formOpen} className="w-full">{formOpen && editForm}</div>}
      {!completedHidden && canEdit && !plan.archived && !embedded && formOpen && editForm}
    </div>
  );
}

type Pending = "save" | "archive" | null;

interface FieldErrors {
  target?: string;
  dates?: string;
  owner?: string;
}

function PlanForm({
  area,
  plan,
  actions,
  targetLocked = false,
  restoring,
  onRestore,
  onSaved,
  onStale,
  onCancel,
}: {
  area: PlanningArea;
  plan: RoadmapItemView | undefined;
  actions: PlanningActions;
  targetLocked?: boolean;
  restoring: boolean;
  onRestore: () => void;
  onSaved: (refreshed: boolean) => void;
  onStale: (text: string, variant: Notice["variant"], refreshed: boolean) => void;
  onCancel: () => void;
}) {
  const { form } = roadmapCopy;
  const { owners } = actions;
  const nodeIds = new Set(area.nodes.map((node) => node.nodeId));

  const existing: ExistingPlanValues | null = plan ? {
    targetNodeId: plan.targetNodeId,
    priority: plan.priority,
    status: plan.status,
    startDate: plan.startDate,
    targetDate: plan.targetDate,
    owner: plan.owner === null ? null : plan.owner.state === "unavailable" ? "unavailable" : plan.owner,
  } : null;
  const initialOwner = existing ? initialOwnerValue(existing.owner) : "";
  const initial: PlanFormValues = {
    // A locked target stays "" so a write can never carry (or replace) the stored one.
    targetNodeId: !targetLocked && existing && nodeIds.has(existing.targetNodeId) ? existing.targetNodeId : "",
    priority: existing?.priority ?? "medium",
    status: existing?.status ?? "planned",
    startDate: existing?.startDate ?? "",
    targetDate: existing?.targetDate ?? "",
    owner: initialOwner,
  };

  const [values, setValues] = useState<PlanFormValues>(initial);
  const [pending, setPending] = useState<Pending>(null);
  const pendingRef = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [recoverArchived, setRecoverArchived] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [reloadNeeded, setReloadNeeded] = useState(false);

  const patch = existing ? buildPatchBody(existing, values) : null;
  const dirty = existing ? patch !== null : true;
  const busy = pending !== null || restoring;
  const idBase = `plan-${area.treeId}`;

  const forward = forwardTargetOptions(area.nodes, area.currentNodeId);
  const targetOptions = area.nodes
    .slice()
    .sort((a, b) => a.order - b.order)
    .filter((node) => forward.some((f) => f.nodeId === node.nodeId) || node.nodeId === existing?.targetNodeId);

  function set<K extends keyof PlanFormValues>(key: K, value: PlanFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function run(kind: Exclude<Pending, null>, send: () => ReturnType<typeof createRoadmapItem>) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(kind);
    setFormError(null);
    setRecoverArchived(false);
    setReloadNeeded(false);
    setFieldErrors({});
    const result = await send();
    if (result.ok) {
      const refreshed = await actions.refresh();
      pendingRef.current = false;
      onSaved(refreshed);
      return;
    }
    const { error } = result;
    if (error === "already_planned") {
      const refreshed = await actions.refresh();
      pendingRef.current = false;
      onStale(
        refreshed ? roadmapCopy.notices.alreadyPlanned : roadmapCopy.notices.alreadyPlannedRefreshFailed,
        refreshed ? "info" : "error",
        refreshed,
      );
      return;
    }
    if (STALE_ERRORS.includes(error)) {
      const refreshed = await actions.refresh();
      pendingRef.current = false;
      const text = errorText(error);
      onStale(refreshed ? text : `${text} ${roadmapCopy.notices.staleRefreshFailed}`, "error", refreshed);
      return;
    }
    if (error === "plan_archived") {
      setRecoverArchived(true);
    } else if (error === "target_not_ahead") {
      setFieldErrors({ target: errorText(error) });
    } else if (error === "invalid_owner") {
      setFieldErrors({ owner: errorText(error) });
      set("owner", initialOwner);
      actions.loadOwners(true);
    } else {
      setFormError(errorText(error));
      if (error === "request_failed") setReloadNeeded(!(await actions.refresh()));
    }
    pendingRef.current = false;
    setPending(null);
  }

  /** GET-only reload for an ambiguous (request_failed) write whose reconciliation GET failed. */
  async function reload() {
    if (await actions.refresh()) {
      setReloadNeeded(false);
      setFormError(null);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!datesInOrder(values.startDate, values.targetDate)) {
      setFieldErrors({ dates: form.datesOutOfOrder });
      return;
    }
    if (!existing) {
      if (values.targetNodeId === "") {
        setFieldErrors({ target: form.targetRequired });
        return;
      }
      void run("save", () => createRoadmapItem(actions.token, actions.teamId, buildCreateBody(area.treeId, values)));
      return;
    }
    if (patch === null) return;
    void run("save", () => updateRoadmapItem(actions.token, actions.teamId, area.treeId, patch));
  }

  function handleArchive() {
    if (busy || !existing || patch !== null) return;
    void run("archive", () => updateRoadmapItem(actions.token, actions.teamId, area.treeId, { archived: true }));
  }

  // Owner options: never the memberRef as text; the value is the only place it appears.
  const ownerOptions: { value: string; label: string }[] = [{ value: "", label: form.ownerNone }];
  if (plan?.owner && plan.owner.state === "unavailable") ownerOptions.push({ value: KEEP_OWNER, label: form.ownerKeep });
  if (owners.phase === "loaded") {
    for (const member of owners.members) {
      ownerOptions.push({
        value: member.memberRef,
        label: formatOwnerName(member.displayName, member.ordinal, member.isSelf),
      });
    }
  }
  const currentOwner = plan?.owner?.state === "current" ? plan.owner : null;
  if (currentOwner && !ownerOptions.some((option) => option.value === currentOwner.memberRef)) {
    ownerOptions.push({
      value: currentOwner.memberRef,
      label: formatOwnerName(currentOwner.displayName, currentOwner.ordinal, currentOwner.isSelf),
    });
  }

  const noTargets = !existing && targetOptions.length === 0;
  const heading = existing ? form.editHeading : form.createHeading;

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={`${heading} – ${area.name}`}
      className="flex w-full flex-col gap-3 rounded border border-zinc-200 p-3 dark:border-zinc-800"
    >
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{heading}</h3>

      {formError && (
        <Alert variant="error" className="text-sm">
          {formError}
        </Alert>
      )}
      {formError && reloadNeeded && (
        <Button variant="secondary" size="sm" type="button" disabled={busy} onClick={reload}>
          {form.reloadPlans}
        </Button>
      )}
      {recoverArchived && (
        <div className="flex flex-col items-start gap-2">
          <Alert variant="error" className="text-sm">
            {errorText("plan_archived")}
          </Alert>
          <Button variant="secondary" size="sm" type="button" disabled={busy} pending={restoring} onClick={onRestore}>
            {restoring ? form.restoring : form.restorePlan}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {targetLocked ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{roadmapCopy.untracked.targetLocked}</p>
        ) : (
        <Select
          id={`${idBase}-target`}
          label={form.target}
          value={values.targetNodeId}
          disabled={busy || noTargets}
          error={fieldErrors.target}
          description={noTargets ? form.noTargetOptions : undefined}
          onChange={(event) => set("targetNodeId", event.target.value)}
        >
          {(values.targetNodeId === "" || !existing) && (
            <option value="">{existing ? form.targetChangePlaceholder : form.targetPlaceholder}</option>
          )}
          {targetOptions.map((option) => (
            <option key={option.nodeId} value={option.nodeId}>
              {option.label}
            </option>
          ))}
        </Select>
        )}

        <Select
          id={`${idBase}-priority`}
          label={form.priority}
          value={values.priority}
          disabled={busy}
          onChange={(event) => set("priority", event.target.value as PlanFormValues["priority"])}
        >
          {ROADMAP_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {roadmapCopy.priority[priority]}
            </option>
          ))}
        </Select>

        {existing && (
          <Select
            id={`${idBase}-status`}
            label={form.status}
            value={values.status}
            disabled={busy}
            onChange={(event) => set("status", event.target.value as PlanFormValues["status"])}
          >
            {ROADMAP_STATUSES.map((status) => (
              <option key={status} value={status}>
                {roadmapCopy.status[status]}
              </option>
            ))}
          </Select>
        )}

        <TextField
          id={`${idBase}-start`}
          type="date"
          label={form.startDate}
          value={values.startDate}
          disabled={busy}
          onChange={(event) => set("startDate", event.target.value)}
        />
        <TextField
          id={`${idBase}-end`}
          type="date"
          label={form.targetDate}
          value={values.targetDate}
          disabled={busy}
          error={fieldErrors.dates}
          onChange={(event) => set("targetDate", event.target.value)}
        />

        <Select
          id={`${idBase}-owner`}
          label={form.owner}
          value={values.owner}
          disabled={busy || owners.phase === "loading"}
          error={fieldErrors.owner}
          description={owners.phase === "loading" ? form.ownerLoading : form.ownerHelp}
          onChange={(event) => set("owner", event.target.value)}
        >
          {ownerOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      {owners.phase === "error" && (
        <div className="flex flex-col items-start gap-2">
          <Alert variant="error" className="text-sm">
            {form.ownerLoadError}
          </Alert>
          <Button variant="secondary" size="sm" type="button" onClick={() => actions.loadOwners(true)}>
            {form.ownerRetry}
          </Button>
        </div>
      )}
      {owners.phase === "loaded" && owners.unavailableCount > 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{form.ownerSomeUnavailable}</p>
      )}
      {owners.phase === "loaded" && owners.truncated && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{form.ownerTruncated}</p>
      )}
      {existing && !dirty && <p className="text-sm text-zinc-600 dark:text-zinc-400">{form.noChanges}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || (existing ? !dirty : noTargets)} pending={pending === "save"}>
          {pending === "save" ? form.saving : form.save}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onCancel}>
          {form.cancel}
        </Button>
        {existing && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy || dirty}
            pending={pending === "archive"}
            onClick={handleArchive}
          >
            {pending === "archive" ? form.archiving : form.archive}
          </Button>
        )}
      </div>
      {existing && dirty && <p className="text-sm text-zinc-600 dark:text-zinc-400">{form.archiveDirtyHint}</p>}
    </form>
  );
}

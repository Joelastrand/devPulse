"use client";

import { useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { Select } from "../../../components/ui/Select";
import { TextArea } from "../../../components/ui/TextArea";
import { TextField } from "../../../components/ui/TextField";
import { workspaceCopy } from "../copy";
import { fetchGoalChoices } from "../client/link-options";
import { isReady, useOwnerRecords, type OwnerRecordsState } from "../client/use-owner-records";
import {
  createResponsibility,
  deleteResponsibility,
  fetchResponsibilities,
  updateResponsibility,
  type GatewayError,
  type GatewayResult,
  type RecordList,
  type ResponsibilityDto,
  type ResponsibilityInput,
} from "../client/records-gateway";
import { RELATION_TO_ROLE_VALUES, type RelationToRole, type ResponsibilityStatus } from "../domain/constants";
import { LinkPicker } from "./LinkPicker";

type Notice = { variant: "success" | "error"; text: string };
type StatusFilter = "all" | ResponsibilityStatus;
type Editing = { mode: "create" } | { mode: "edit"; record: ResponsibilityDto } | null;

const copy = workspaceCopy.responsibilities;

interface FormValues {
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  relationToRole: RelationToRole;
  goalIds: string[];
}

function valuesFrom(record: ResponsibilityDto | null): FormValues {
  return {
    title: record?.title ?? "",
    description: record?.description ?? "",
    startDate: record?.startDate ?? "",
    endDate: record?.endDate ?? "",
    relationToRole: record?.relationToRole ?? "unspecified",
    goalIds: record ? [...record.goalIds] : [],
  };
}

/** Maps the form to the API input. Empty optional fields become `null`; the server validates everything again. */
function inputFrom(values: FormValues, status: ResponsibilityStatus): ResponsibilityInput {
  const description = values.description.trim();
  return {
    title: values.title.trim(),
    description: description === "" ? null : description,
    status,
    relationToRole: values.relationToRole,
    startDate: values.startDate === "" ? null : values.startDate,
    endDate: values.endDate === "" ? null : values.endDate,
    goalIds: values.goalIds,
  };
}

const errorNotice = (error: GatewayError): Notice => ({ variant: "error", text: workspaceCopy.errors[error] });

/** `onChanged` tells the workspace that a responsibility changed, so linked achievements can show the current BR-22 state. */
export function ResponsibilitiesSection({ onChanged }: { onChanged?: () => void } = {}) {
  const records = useOwnerRecords(fetchResponsibilities);
  const goals = useOwnerRecords(fetchGoalChoices);
  const [editing, setEditing] = useState<Editing>(null);
  const [values, setValues] = useState<FormValues>(valuesFrom(null));
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  /** Goal choices are read when the form opens, so a goal created elsewhere is selectable at once. */
  const openForm = (next: Editing) => {
    void goals.reload();
    setEditing(next);
    setValues(valuesFrom(next?.mode === "edit" ? next.record : null));
    setNotice(null);
  };

  /** Leaves the form after a save; the success notice stays visible. */
  const closeForm = () => setEditing(null);

  const cancelForm = () => {
    setEditing(null);
    setNotice(null);
  };

  /** Runs one write through the owner gateway. A success reloads the canonical list and returns true. */
  const run = async (action: (token: string) => Promise<GatewayResult<unknown>>, success: string): Promise<boolean> => {
    const result = await records.mutate(action);
    if (result.ok) {
      setNotice({ variant: "success", text: success });
      onChanged?.();
    } else {
      setNotice(errorNotice(result.error));
    }
    return result.ok;
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    if (values.title.trim() === "") {
      setNotice({ variant: "error", text: workspaceCopy.errors.invalid_input });
      return;
    }
    setSaving(true);
    const ok =
      editing.mode === "create"
        ? await run((token) => createResponsibility(token, inputFrom(values, "active")), copy.success.created)
        : await run(
            (token) => updateResponsibility(token, editing.record.id, inputFrom(values, editing.record.status)),
            copy.success.updated,
          );
    setSaving(false);
    if (ok) closeForm();
  };

  const toggleStatus = (record: ResponsibilityDto) => {
    const next: ResponsibilityStatus = record.status === "active" ? "completed" : "active";
    void run(
      (token) => updateResponsibility(token, record.id, { status: next }),
      next === "completed" ? copy.success.completed : copy.success.reopened,
    );
  };

  const remove = (id: string) => {
    setConfirmId(null);
    if (editing?.mode === "edit" && editing.record.id === id) closeForm();
    void run((token) => deleteResponsibility(token, id), copy.success.deleted);
  };

  const goalChoices = isReady(goals.state) ? goals.state.data : [];
  const knownGoalIds = new Set(goalChoices.map((goal) => goal.id));
  const missingGoalIds = isReady(goals.state) ? values.goalIds.filter((id) => !knownGoalIds.has(id)) : [];

  return (
    <section aria-labelledby="responsibilities-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="responsibilities-heading" className="text-lg font-semibold text-text-primary">{copy.heading}</h2>
          <p className="text-sm text-text-secondary">{copy.description}</p>
        </div>
        {editing === null && isReady(records.state) ? (
          <Button type="button" variant="secondary" onClick={() => openForm({ mode: "create" })}>{copy.add}</Button>
        ) : null}
      </div>

      {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}

      {isReady(records.state) ? (
        <Select
          id="responsibility-status-filter"
          label={copy.filter.label}
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
        >
          <option value="all">{copy.filter.all}</option>
          <option value="active">{copy.filter.active}</option>
          <option value="completed">{copy.filter.completed}</option>
        </Select>
      ) : null}

      {editing ? (
        <Card as="div" variant="bordered" padding="md">
          <form onSubmit={submit} aria-labelledby="responsibility-form-heading" className="space-y-4">
            <h3 id="responsibility-form-heading" className="text-base font-semibold text-text-primary">
              {editing.mode === "create" ? copy.createTitle : copy.editTitle}
            </h3>
            <TextField
              id="responsibility-title"
              label={copy.fields.title}
              required
              maxLength={120}
              value={values.title}
              onChange={(event) => setValues({ ...values, title: event.target.value })}
              autoFocus
            />
            <TextArea
              id="responsibility-description"
              label={copy.fields.description}
              optional
              maxLength={2000}
              value={values.description}
              onChange={(event) => setValues({ ...values, description: event.target.value })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="responsibility-start"
                type="date"
                label={copy.fields.startDate}
                optional
                value={values.startDate}
                onChange={(event) => setValues({ ...values, startDate: event.target.value })}
              />
              <TextField
                id="responsibility-end"
                type="date"
                label={copy.fields.endDate}
                optional
                value={values.endDate}
                onChange={(event) => setValues({ ...values, endDate: event.target.value })}
              />
            </div>
            <Select
              id="responsibility-relation"
              label={workspaceCopy.relationLabel}
              value={values.relationToRole}
              onChange={(event) => setValues({ ...values, relationToRole: event.target.value as RelationToRole })}
            >
              {RELATION_TO_ROLE_VALUES.map((value) => (
                <option key={value} value={value}>{workspaceCopy.relationOptions[value]}</option>
              ))}
            </Select>
            <LinkPicker
              idPrefix="responsibility-goal"
              legend={workspaceCopy.links.goals}
              options={goalChoices}
              selected={values.goalIds}
              emptyText={workspaceCopy.links.noGoals}
              missingIds={missingGoalIds}
              onChange={(goalIds) => setValues({ ...values, goalIds })}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" pending={saving}>{workspaceCopy.responsibilities.save}</Button>
              <Button type="button" variant="secondary" onClick={cancelForm}>{copy.cancel}</Button>
            </div>
          </form>
        </Card>
      ) : null}

      <ResponsibilityList
        state={records.state}
        statusFilter={statusFilter}
        onRetry={() => void records.reload()}
        onEdit={(record) => openForm({ mode: "edit", record })}
        onToggle={toggleStatus}
        confirmId={confirmId}
        onAskDelete={setConfirmId}
        onDelete={remove}
      />
    </section>
  );
}

/** Active records come first, then completed; the server order is kept within each group. */
function activeFirst(records: readonly ResponsibilityDto[]): ResponsibilityDto[] {
  return [...records].sort((a, b) => Number(b.status === "active") - Number(a.status === "active"));
}

interface ResponsibilityListProps {
  state: OwnerRecordsState<RecordList<ResponsibilityDto>>;
  statusFilter: StatusFilter;
  onRetry: () => void;
  onEdit: (record: ResponsibilityDto) => void;
  onToggle: (record: ResponsibilityDto) => void;
  confirmId: string | null;
  onAskDelete: (id: string | null) => void;
  onDelete: (id: string) => void;
}

/** Renders the owner's list in every state: loading, signed out, error, empty, and ready with recovery items. */
function ResponsibilityList({ state, statusFilter, onRetry, onEdit, onToggle, confirmId, onAskDelete, onDelete }: ResponsibilityListProps) {
  if (state.phase === "loading") return <LoadingState />;
  if (state.phase === "signed_out") return <EmptyState>{workspaceCopy.signedOut}</EmptyState>;
  if (state.phase === "error") {
    return (
      <div className="space-y-2">
        <Alert variant="error">{workspaceCopy.errors[state.error]}</Alert>
        <Button type="button" variant="secondary" onClick={onRetry}>{workspaceCopy.retry}</Button>
      </div>
    );
  }
  const { data } = state;
  const visible = activeFirst(data.records).filter((record) => statusFilter === "all" || record.status === statusFilter);
  return (
    <div className="space-y-4">
      {data.truncated ? <Alert variant="info">{copy.truncated}</Alert> : null}
      {data.records.length === 0 ? <EmptyState>{copy.empty}</EmptyState> : null}
      {data.records.length > 0 && visible.length === 0 ? <EmptyState>{copy.filter.empty}</EmptyState> : null}
      <ul className="space-y-3">
        {visible.map((record) => (
          <li key={record.id}>
            <Card as="div" variant="bordered" padding="sm" className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="break-words text-base font-semibold text-text-primary">{record.title}</h3>
                <span className="rounded-control border border-border-subtle px-2 py-0.5 text-xs text-text-secondary">
                  {workspaceCopy.statusLabels[record.status]}
                </span>
              </div>
              {record.description ? <p className="whitespace-pre-line break-words text-sm text-text-secondary">{record.description}</p> : null}
              <p className="text-xs text-text-secondary">
                {workspaceCopy.relationOptions[record.relationToRole]}
                {record.startDate ? ` · fra ${record.startDate}` : ""}
                {record.endDate ? ` · til ${record.endDate}` : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => onEdit(record)}>{copy.edit}</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => onToggle(record)}>
                  {record.status === "active" ? copy.complete : copy.reopen}
                </Button>
                {confirmId === record.id ? (
                  <ConfirmDelete onConfirm={() => onDelete(record.id)} onCancel={() => onAskDelete(null)} />
                ) : (
                  <Button type="button" size="sm" variant="destructive" onClick={() => onAskDelete(record.id)}>{copy.delete}</Button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {data.unavailableCount > 0 ? <p className="text-sm text-text-secondary">{copy.unavailable}</p> : null}
      {data.recoveryItems.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-text-primary">{copy.recoveryHeading}</h3>
          <p className="text-sm text-text-secondary">{copy.recoveryText}</p>
          <ul className="space-y-2">
            {data.recoveryItems.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2">
                {confirmId === item.id ? (
                  <ConfirmDelete onConfirm={() => onDelete(item.id)} onCancel={() => onAskDelete(null)} />
                ) : (
                  <Button type="button" size="sm" variant="destructive" onClick={() => onAskDelete(item.id)}>{copy.recoveryDelete}</Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ConfirmDelete({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div role="group" aria-label={copy.deleteConfirm} className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-text-primary">{copy.deleteConfirm}</span>
      <Button type="button" size="sm" variant="destructive" onClick={onConfirm}>{copy.confirmDelete}</Button>
      <Button type="button" size="sm" variant="secondary" onClick={onCancel}>{copy.cancel}</Button>
    </div>
  );
}

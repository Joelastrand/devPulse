"use client";

import { useEffect, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { Select } from "../../../components/ui/Select";
import { TextArea } from "../../../components/ui/TextArea";
import { TextField } from "../../../components/ui/TextField";
import { workspaceCopy } from "../copy";
import { fetchGoalChoices, fetchResponsibilityChoices, type LinkChoice } from "../client/link-options";
import { isReady, useOwnerRecords, type OwnerRecordsState } from "../client/use-owner-records";
import {
  createAchievement,
  deleteAchievement,
  fetchAchievements,
  updateAchievement,
  type AchievementDto,
  type AchievementInput,
  type GatewayError,
  type GatewayResult,
  type RecordList,
} from "../client/records-gateway";
import { RELATION_TO_ROLE_VALUES, type RelationToRole } from "../domain/constants";
import { LinkPicker } from "./LinkPicker";

type Notice = { variant: "success" | "error"; text: string };
type Editing = { mode: "create" } | { mode: "edit"; record: AchievementDto } | null;

const copy = workspaceCopy.achievements;

interface FormValues {
  title: string;
  description: string;
  outcome: string;
  relationToRole: RelationToRole;
  periodStart: string;
  periodEnd: string;
  goalIds: string[];
  responsibilityIds: string[];
}

function valuesFrom(record: AchievementDto | null): FormValues {
  return {
    title: record?.title ?? "",
    description: record?.description ?? "",
    outcome: record?.outcome ?? "",
    relationToRole: record?.relationToRole ?? "unspecified",
    periodStart: record?.periodStart ?? "",
    periodEnd: record?.periodEnd ?? "",
    goalIds: record ? [...record.goalIds] : [],
    responsibilityIds: record ? [...record.responsibilityIds] : [],
  };
}

function inputFrom(values: FormValues): AchievementInput {
  const outcome = values.outcome.trim();
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    outcome: outcome === "" ? null : outcome,
    relationToRole: values.relationToRole,
    periodStart: values.periodStart === "" ? null : values.periodStart,
    periodEnd: values.periodEnd === "" ? null : values.periodEnd,
    goalIds: values.goalIds,
    responsibilityIds: values.responsibilityIds,
  };
}

type RelationFilter = "all" | RelationToRole;

/**
 * Period filter (BR-24). An achievement matches when its period overlaps the chosen range. A record without any date only
 * matches when no period filter is set, so an undated record is never hidden by a date it does not have.
 */
function matchesPeriod(record: AchievementDto, from: string, to: string): boolean {
  if (from === "" && to === "") return true;
  const start = record.periodStart ?? record.periodEnd;
  const end = record.periodEnd ?? record.periodStart;
  if (start === null || end === null) return false;
  if (from !== "" && end < from) return false;
  if (to !== "" && start > to) return false;
  return true;
}

/**
 * Chronology (BR-23): by the period start when given, otherwise by the creation date, then by creation time. Only the
 * order changes; no score, rating or impact ranking is ever computed.
 */
function chronological(records: readonly AchievementDto[]): AchievementDto[] {
  const dateKey = (record: AchievementDto) => record.periodStart ?? record.createdAt.slice(0, 10);
  return [...records].sort((a, b) => dateKey(a).localeCompare(dateKey(b)) || a.createdAt.localeCompare(b.createdAt));
}

const errorNotice = (error: GatewayError): Notice => ({ variant: "error", text: workspaceCopy.errors[error] });

/** `revision` changes when a linked record changed elsewhere; the list is then re-read so BR-22 markers are current. */
export function AchievementsSection({ revision = 0 }: { revision?: number } = {}) {
  const records = useOwnerRecords(fetchAchievements);
  const reloadRecords = records.reload;
  useEffect(() => {
    if (revision > 0) void reloadRecords();
  }, [revision, reloadRecords]);
  const goals = useOwnerRecords(fetchGoalChoices);
  const responsibilities = useOwnerRecords(fetchResponsibilityChoices);
  const [editing, setEditing] = useState<Editing>(null);
  const [values, setValues] = useState<FormValues>(valuesFrom(null));
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [relationFilter, setRelationFilter] = useState<RelationFilter>("all");
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");

  /** Link choices are read when the form opens, so a record created in another section is selectable at once. */
  const openForm = (next: Editing) => {
    void goals.reload();
    void responsibilities.reload();
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

  const run = async (action: (token: string) => Promise<GatewayResult<unknown>>, success: string): Promise<boolean> => {
    const result = await records.mutate(action);
    if (result.ok) setNotice({ variant: "success", text: success });
    else setNotice(errorNotice(result.error));
    return result.ok;
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    if (values.title.trim() === "" || values.description.trim() === "") {
      setNotice({ variant: "error", text: workspaceCopy.errors.invalid_input });
      return;
    }
    setSaving(true);
    const input = inputFrom(values);
    const ok =
      editing.mode === "create"
        ? await run((token) => createAchievement(token, input), copy.success.created)
        : await run((token) => updateAchievement(token, editing.record.id, input), copy.success.updated);
    setSaving(false);
    if (ok) closeForm();
  };

  const remove = (id: string) => {
    setConfirmId(null);
    if (editing?.mode === "edit" && editing.record.id === id) closeForm();
    void run((token) => deleteAchievement(token, id), copy.success.deleted);
  };

  const goalChoices = isReady(goals.state) ? goals.state.data : [];
  const responsibilityChoices = isReady(responsibilities.state) ? responsibilities.state.data : [];
  const missingGoalIds = isReady(goals.state) ? values.goalIds.filter((id) => !goalChoices.some((goal) => goal.id === id)) : [];
  const missingResponsibilityIds = isReady(responsibilities.state)
    ? values.responsibilityIds.filter((id) => !responsibilityChoices.some((item) => item.id === id))
    : [];

  return (
    <section aria-labelledby="achievements-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="achievements-heading" className="text-lg font-semibold text-text-primary">{copy.heading}</h2>
          <p className="text-sm text-text-secondary">{copy.description}</p>
        </div>
        {editing === null && isReady(records.state) ? (
          <Button type="button" variant="secondary" onClick={() => openForm({ mode: "create" })}>{copy.add}</Button>
        ) : null}
      </div>

      {notice ? <Alert variant={notice.variant}>{notice.text}</Alert> : null}

      {isReady(records.state) ? (
        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="sr-only">{copy.filter.relation}</legend>
          <Select id="achievement-relation-filter" label={copy.filter.relation} value={relationFilter} onChange={(event) => setRelationFilter(event.target.value as RelationFilter)}>
            <option value="all">{copy.filter.relationAll}</option>
            {RELATION_TO_ROLE_VALUES.map((value) => (
              <option key={value} value={value}>{workspaceCopy.relationOptions[value]}</option>
            ))}
          </Select>
          <TextField id="achievement-from-filter" type="date" label={copy.filter.from} optional value={fromFilter} onChange={(event) => setFromFilter(event.target.value)} />
          <TextField id="achievement-to-filter" type="date" label={copy.filter.to} optional value={toFilter} onChange={(event) => setToFilter(event.target.value)} />
          <div className="sm:col-span-3">
            <Button type="button" size="sm" variant="tertiary" onClick={() => { setRelationFilter("all"); setFromFilter(""); setToFilter(""); }}>{copy.filter.reset}</Button>
          </div>
        </fieldset>
      ) : null}

      {editing ? (
        <Card as="div" variant="bordered" padding="md">
          <form onSubmit={submit} aria-labelledby="achievement-form-heading" className="space-y-4">
            <h3 id="achievement-form-heading" className="text-base font-semibold text-text-primary">
              {editing.mode === "create" ? copy.createTitle : copy.editTitle}
            </h3>
            <TextField
              id="achievement-title"
              label={copy.fields.title}
              required
              maxLength={120}
              value={values.title}
              onChange={(event) => setValues({ ...values, title: event.target.value })}
              autoFocus
            />
            <TextArea
              id="achievement-description"
              label={copy.fields.description}
              required
              maxLength={2000}
              value={values.description}
              onChange={(event) => setValues({ ...values, description: event.target.value })}
            />
            <TextArea
              id="achievement-outcome"
              label={copy.fields.outcome}
              optional
              maxLength={1000}
              value={values.outcome}
              onChange={(event) => setValues({ ...values, outcome: event.target.value })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="achievement-period-start"
                type="date"
                label={copy.fields.periodStart}
                optional
                value={values.periodStart}
                onChange={(event) => setValues({ ...values, periodStart: event.target.value })}
              />
              <TextField
                id="achievement-period-end"
                type="date"
                label={copy.fields.periodEnd}
                optional
                value={values.periodEnd}
                onChange={(event) => setValues({ ...values, periodEnd: event.target.value })}
              />
            </div>
            <Select
              id="achievement-relation"
              label={workspaceCopy.relationLabel}
              value={values.relationToRole}
              onChange={(event) => setValues({ ...values, relationToRole: event.target.value as RelationToRole })}
            >
              {RELATION_TO_ROLE_VALUES.map((value) => (
                <option key={value} value={value}>{workspaceCopy.relationOptions[value]}</option>
              ))}
            </Select>
            <LinkPicker
              idPrefix="achievement-responsibility"
              legend={workspaceCopy.links.responsibilities}
              options={responsibilityChoices}
              selected={values.responsibilityIds}
              emptyText={workspaceCopy.links.noResponsibilities}
              missingIds={missingResponsibilityIds}
              onChange={(responsibilityIds) => setValues({ ...values, responsibilityIds })}
            />
            <LinkPicker
              idPrefix="achievement-goal"
              legend={workspaceCopy.links.goals}
              options={goalChoices}
              selected={values.goalIds}
              emptyText={workspaceCopy.links.noGoals}
              missingIds={missingGoalIds}
              onChange={(goalIds) => setValues({ ...values, goalIds })}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" pending={saving}>{workspaceCopy.achievements.save}</Button>
              <Button type="button" variant="secondary" onClick={cancelForm}>{copy.cancel}</Button>
            </div>
          </form>
        </Card>
      ) : null}

      <AchievementList
        state={records.state}
        relationFilter={relationFilter}
        fromFilter={fromFilter}
        toFilter={toFilter}
        goalChoices={goalChoices}
        responsibilityChoices={responsibilityChoices}
        onRetry={() => void records.reload()}
        onEdit={(record) => openForm({ mode: "edit", record })}
        confirmId={confirmId}
        onAskDelete={setConfirmId}
        onDelete={remove}
      />
    </section>
  );
}

interface AchievementListProps {
  state: OwnerRecordsState<RecordList<AchievementDto>>;
  relationFilter: RelationFilter;
  fromFilter: string;
  toFilter: string;
  goalChoices: readonly LinkChoice[];
  responsibilityChoices: readonly LinkChoice[];
  onRetry: () => void;
  onEdit: (record: AchievementDto) => void;
  confirmId: string | null;
  onAskDelete: (id: string | null) => void;
  onDelete: (id: string) => void;
}

/** Renders the achievement list in every state. Missing links use the BR-22 text and never block the page. */
function AchievementList({ state, relationFilter, fromFilter, toFilter, goalChoices, responsibilityChoices, onRetry, onEdit, confirmId, onAskDelete, onDelete }: AchievementListProps) {
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
  const visible = chronological(data.records).filter(
    (record) => (relationFilter === "all" || record.relationToRole === relationFilter) && matchesPeriod(record, fromFilter, toFilter),
  );
  return (
    <div className="space-y-4">
      {data.truncated ? <Alert variant="info">{copy.truncated}</Alert> : null}
      {data.records.length === 0 ? <EmptyState>{copy.empty}</EmptyState> : null}
      {data.records.length > 0 && visible.length === 0 ? <EmptyState>{copy.filter.empty}</EmptyState> : null}
      <ul className="space-y-3">
        {visible.map((record) => {
          const responsibilityNames = record.responsibilityIds.flatMap((id) => responsibilityChoices.filter((choice) => choice.id === id).map((choice) => choice.title));
          const goalNames = record.goalIds.flatMap((id) => goalChoices.filter((choice) => choice.id === id).map((choice) => choice.title));
          const missing = (record.missingLinks?.goalIds.length ?? 0) + (record.missingLinks?.responsibilityIds.length ?? 0);
          return (
            <li key={record.id}>
              <Card as="div" variant="bordered" padding="sm" className="space-y-2">
                <h3 className="break-words text-base font-semibold text-text-primary">{record.title}</h3>
                <p className="whitespace-pre-line break-words text-sm text-text-secondary">{record.description}</p>
                {record.outcome ? <p className="whitespace-pre-line break-words text-sm text-text-primary">{record.outcome}</p> : null}
                {responsibilityNames.length > 0 ? <p className="text-xs text-text-secondary">{copy.linkedResponsibility}: {responsibilityNames.join(", ")}</p> : null}
                {goalNames.length > 0 ? <p className="text-xs text-text-secondary">{copy.linkedGoal}: {goalNames.join(", ")}</p> : null}
                <p className="text-xs text-text-secondary">
                  {workspaceCopy.relationOptions[record.relationToRole]}
                  {record.periodStart ? ` · fra ${record.periodStart}` : ""}
                  {record.periodEnd ? ` · til ${record.periodEnd}` : ""}
                </p>
                {missing > 0 ? <p className="text-xs text-text-secondary">{workspaceCopy.missingLink}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => onEdit(record)}>{copy.edit}</Button>
                  {confirmId === record.id ? (
                    <ConfirmDelete onConfirm={() => onDelete(record.id)} onCancel={() => onAskDelete(null)} />
                  ) : (
                    <Button type="button" size="sm" variant="destructive" onClick={() => onAskDelete(record.id)}>{copy.delete}</Button>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
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

"use client";

import { useId, useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { TextArea } from "../../../components/ui/TextArea";
import { TextField } from "../../../components/ui/TextField";
import { cx, FORM_CONTROL_CLASSNAME, FORM_CONTROL_HEIGHT_CLASSNAME } from "../../../components/ui/class-names";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Icon } from "../../../components/ui/Icon";
import {
  ASSESSMENT_ATTRIBUTES,
  ASSESSMENT_ATTRIBUTE_LABELS,
  ASSESSMENT_VALUES,
  ASSESSMENT_VALUE_LABELS,
  TEAM_SYSTEM_LIMITS,
  parseBackstageUrl,
  parseOptionalText,
  parseSystemName,
  type AssessmentAttribute,
  type AssessmentValue,
} from "../domain/team-system";
import { AttributeInfoButton } from "./ExplanationDialog";
import type { AssignableMemberOption, TeamSystemMutationError, TeamSystemMutationResult } from "../client/team-systems-gateway";
import type { TeamSystemView } from "../server/list-team-systems";
import { systemsCopy } from "../copy";

type AssessmentDraft = { value: AssessmentValue; note: string };

interface Draft {
  name: string;
  description: string;
  backstageUrl: string;
  assessments: Record<AssessmentAttribute, AssessmentDraft>;
  knowledge: string[];
}

function draftFrom(system: TeamSystemView | null): Draft {
  const assessment = (attribute: AssessmentAttribute): AssessmentDraft => ({
    value: system?.assessments[attribute].value ?? "ikke_vurdert",
    note: system?.assessments[attribute].note ?? "",
  });
  const assessments = {} as Record<AssessmentAttribute, AssessmentDraft>;
  for (const attribute of ASSESSMENT_ATTRIBUTES) assessments[attribute] = assessment(attribute);
  return {
    name: system?.name ?? "",
    description: system?.description ?? "",
    backstageUrl: system?.backstageUrl ?? "",
    assessments,
    knowledge: system?.knowledge.map((member) => member.memberRef) ?? [],
  };
}

/** Client-side checks mirror the server's limits for early feedback only; the server decides. */
function validate(draft: Draft): { errors: Partial<Record<"name" | "description" | "backstageUrl" | "note" | "knowledge", string>>; body: Record<string, unknown> | null } {
  const errors: Partial<Record<"name" | "description" | "backstageUrl" | "note" | "knowledge", string>> = {};
  const name = parseSystemName(draft.name);
  if (name === null) {
    errors.name = draft.name.trim().length === 0 ? systemsCopy.form.nameRequired : systemsCopy.form.nameTooLong;
  }
  const description = parseOptionalText(draft.description, TEAM_SYSTEM_LIMITS.descriptionMax);
  if (description === undefined) errors.description = systemsCopy.form.descriptionTooLong;
  const url = parseBackstageUrl(draft.backstageUrl);
  if (!url.ok) errors.backstageUrl = systemsCopy.form.backstageInvalid;
  for (const attribute of ASSESSMENT_ATTRIBUTES) {
    if (parseOptionalText(draft.assessments[attribute].note, TEAM_SYSTEM_LIMITS.noteMax) === undefined) {
      errors.note = systemsCopy.form.noteTooLong;
    }
  }
  if (draft.knowledge.length > TEAM_SYSTEM_LIMITS.knowledgeMembersMax) errors.knowledge = systemsCopy.form.knowledgeTooMany;

  if (Object.keys(errors).length > 0 || name === null || description === undefined || !url.ok) {
    return { errors, body: null };
  }
  const assessments: Record<string, { value: AssessmentValue; note: string | null }> = {};
  for (const attribute of ASSESSMENT_ATTRIBUTES) {
    assessments[attribute] = {
      value: draft.assessments[attribute].value,
      note: parseOptionalText(draft.assessments[attribute].note, TEAM_SYSTEM_LIMITS.noteMax) ?? null,
    };
  }
  return {
    errors,
    body: { name, description, backstageUrl: url.value, assessments, knowledgeMemberRefs: draft.knowledge },
  };
}

function mutationMessage(error: TeamSystemMutationError): string {
  switch (error) {
    case "forbidden":
    case "unauthenticated":
      return systemsCopy.form.accessDenied;
    case "team_disabled":
      return systemsCopy.form.teamDisabled;
    case "invalid_knowledge":
      return systemsCopy.form.invalidKnowledge;
    case "limit_reached":
      return systemsCopy.form.limitReached;
    case "not_found":
      return systemsCopy.form.notFound;
    case "request_failed":
      return systemsCopy.form.requestFailed;
    default:
      return systemsCopy.form.genericError;
  }
}

/**
 * One quality assessment in the form (reference 17). The chevron, the information
 * button and the status select are independent controls: the chevron toggles the
 * note only, the info button opens its own dialog, and the select changes only the
 * value. The note lives in the page's draft, so collapsing never discards it.
 */
function AssessmentRow({
  idPrefix,
  attribute,
  value,
  note,
  onValueChange,
  onNoteChange,
}: {
  idPrefix: string;
  attribute: AssessmentAttribute;
  value: AssessmentValue;
  note: string;
  onValueChange: (value: AssessmentValue) => void;
  onNoteChange: (note: string) => void;
}) {
  // Open by default when a note already exists, so saved explanations are visible on reopen.
  const [expanded, setExpanded] = useState(note.trim().length > 0);
  const name = ASSESSMENT_ATTRIBUTE_LABELS[attribute];
  const panelId = `${idPrefix}-panel`;

  return (
    <div className="rounded-control border border-border-subtle bg-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={expanded ? systemsCopy.form.rowCollapse(name) : systemsCopy.form.rowExpand(name)}
          onClick={() => setExpanded((current) => !current)}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-control text-text-muted hover:bg-surface-subtle hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Icon icon={expanded ? ChevronDown : ChevronRight} size="inline" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1 text-label font-semibold text-text-primary">
            {name}
            <AttributeInfoButton attribute={attribute} />
          </span>
          <span className="text-help text-text-muted">{systemsCopy.formHints[attribute]}</span>
        </div>
        <select
          id={`${idPrefix}-value`}
          aria-label={`${systemsCopy.form.assessmentValue}: ${name}`}
          value={value}
          onChange={(event) => onValueChange(event.target.value as AssessmentValue)}
          className={cx(FORM_CONTROL_CLASSNAME, FORM_CONTROL_HEIGHT_CLASSNAME, "w-full sm:w-56")}
        >
          {ASSESSMENT_VALUES.map((option) => (
            <option key={option} value={option}>
              {ASSESSMENT_VALUE_LABELS[option]}
            </option>
          ))}
        </select>
      </div>
      {expanded && (
        <div id={panelId} className="border-t border-border-subtle bg-surface-subtle px-3 pb-3 pt-3 sm:ml-10">
          <TextArea
            id={`${idPrefix}-note`}
            label={systemsCopy.form.rationale}
            description={systemsCopy.form.assessmentNoteHelp}
            optional
            rows={2}
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
          />
        </div>
      )}
    </div>
  );
}

export interface SystemFormProps {
  /** `null` creates a system; a view edits that system. */
  system: TeamSystemView | null;
  members: readonly AssignableMemberOption[];
  membersStatus: "loading" | "ok" | "error";
  onSubmit: (body: Record<string, unknown>) => Promise<TeamSystemMutationResult>;
  onDone: () => void;
  onCancel: () => void;
}

/**
 * Create / edit form for one system (SPEC — BR-4 to BR-8). Controlled draft
 * state, inline field errors, and a live server error summary. Writes go
 * through the page's gateway; nothing here is authorization.
 */
export function SystemForm({ system, members, membersStatus, onSubmit, onDone, onCancel }: SystemFormProps) {
  const idBase = useId();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(system));
  const [errors, setErrors] = useState<ReturnType<typeof validate>["errors"]>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const title = system === null ? systemsCopy.form.createTitle : systemsCopy.form.editTitle;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validate(draft);
    setErrors(result.errors);
    setServerError(null);
    if (result.body === null) return;

    setSaving(true);
    const outcome = await onSubmit(result.body);
    setSaving(false);
    if (outcome.ok) {
      onDone();
      return;
    }
    setServerError(mutationMessage(outcome.error));
  }

  function toggleKnowledge(memberRef: string, checked: boolean) {
    setDraft((current) => ({
      ...current,
      knowledge: checked
        ? [...current.knowledge.filter((ref) => ref !== memberRef), memberRef]
        : current.knowledge.filter((ref) => ref !== memberRef),
    }));
  }

  return (
    <Card as="section" variant="elevated" padding="lg" aria-labelledby={`${idBase}-title`}>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
        <h2 id={`${idBase}-title`} className="text-section-title font-semibold text-text-primary">
          {title}
        </h2>

        {serverError !== null && <Alert variant="error">{serverError}</Alert>}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TextField
            id={`${idBase}-name`}
            label={systemsCopy.form.name}
            description={systemsCopy.form.nameHelp}
            error={errors.name}
            value={draft.name}
            maxLength={TEAM_SYSTEM_LIMITS.nameMax + 20}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            required
          />
          <TextField
            id={`${idBase}-backstage`}
            type="url"
            label={systemsCopy.form.backstageUrl}
            description={systemsCopy.form.backstageUrlHelp}
            error={errors.backstageUrl}
            value={draft.backstageUrl}
            optional
            onChange={(event) => setDraft({ ...draft, backstageUrl: event.target.value })}
          />
        </div>

        <TextArea
          id={`${idBase}-description`}
          label={systemsCopy.form.description}
          description={systemsCopy.form.descriptionHelp}
          error={errors.description}
          value={draft.description}
          optional
          rows={3}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
        />

        <fieldset className="flex flex-col gap-3">
          <legend className="text-label font-semibold text-text-primary">{systemsCopy.form.assessmentsTitle}</legend>
          {errors.note && <Alert variant="error">{errors.note}</Alert>}
          {ASSESSMENT_ATTRIBUTES.map((attribute) => (
            <AssessmentRow
              key={attribute}
              idPrefix={`${idBase}-${attribute}`}
              attribute={attribute}
              value={draft.assessments[attribute].value}
              note={draft.assessments[attribute].note}
              onValueChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  assessments: { ...current.assessments, [attribute]: { ...current.assessments[attribute], value } },
                }))
              }
              onNoteChange={(note) =>
                setDraft((current) => ({
                  ...current,
                  assessments: { ...current.assessments, [attribute]: { ...current.assessments[attribute], note } },
                }))
              }
            />
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-label font-semibold text-text-primary">{systemsCopy.form.knowledgeTitle}</legend>
          <p className="text-help text-text-muted">{systemsCopy.form.knowledgeHelp}</p>
          {errors.knowledge && <Alert variant="error">{errors.knowledge}</Alert>}
          {membersStatus === "loading" && <p className="text-help text-text-muted">{systemsCopy.loading}</p>}
          {membersStatus === "error" && <Alert variant="error">{systemsCopy.form.knowledgeUnavailable}</Alert>}
          {membersStatus === "ok" && members.length === 0 && <p className="text-help text-text-muted">{systemsCopy.form.knowledgeEmpty}</p>}
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {members.map((member, index) => {
              const checkboxId = `${idBase}-knowledge-${index}`;
              return (
                <li key={member.memberRef}>
                  <label htmlFor={checkboxId} className="flex items-center gap-2 text-label text-text-primary">
                    <input
                      id={checkboxId}
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={draft.knowledge.includes(member.memberRef)}
                      onChange={(event) => toggleKnowledge(member.memberRef, event.target.checked)}
                    />
                    {member.displayName ?? systemsCopy.form.unnamedMember}
                    {member.isSelf ? " (deg)" : ""}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>

        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
            {systemsCopy.cancel}
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? systemsCopy.saving : systemsCopy.form.save}
          </Button>
        </div>
      </form>
    </Card>
  );
}

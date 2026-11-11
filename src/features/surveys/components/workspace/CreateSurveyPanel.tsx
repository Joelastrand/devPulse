"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "../../../../components/ui/Alert";
import { Button } from "../../../../components/ui/Button";
import { Card } from "../../../../components/ui/Card";
import { Select } from "../../../../components/ui/Select";
import { TextArea } from "../../../../components/ui/TextArea";
import { TextField } from "../../../../components/ui/TextField";
import { createAdminSurvey, type CreateAdminSurveyInput } from "../../client/admin-survey-gateway";
import { builderCopy, validationMessage } from "../../builder-copy";
import { DEFAULT_MINIMUM_RESPONSES, MINIMUM_RESPONSES_MAX, MINIMUM_RESPONSES_MIN } from "../../domain/survey";
import { listBuiltInTemplates, type BuiltInTemplateId } from "../../domain/templates";
import { newQuestion, toIsoOrRaw } from "../../domain/survey-draft";

export interface CreateSurveyPanelProps {
  teamId: string;
  token: string;
  onCreated: (surveyId: string) => void;
  onCancel: () => void;
}

type Source = "blank" | BuiltInTemplateId;

/**
 * Creates a survey from a blank start or a built-in template
 * (team-survey-builder TSB-004). A template is sent by id only: the server
 * copies its definitions, so the client never supplies question data for it.
 * A blank survey starts with one rating question that the author edits next.
 */
export function CreateSurveyPanel({ teamId, token, onCreated, onCancel }: CreateSurveyPanelProps) {
  const [source, setSource] = useState<Source>("blank");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [accessMode, setAccessMode] = useState<"public" | "authenticated">("public");
  const [minimumResponses, setMinimumResponses] = useState(String(DEFAULT_MINIMUM_RESPONSES));
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    const input: CreateAdminSurveyInput = {
      accessMode,
      minimumResponses: Number(minimumResponses),
      ...(title.trim() !== "" ? { title: title.trim() } : {}),
      ...(description.trim() !== "" ? { description: description.trim() } : {}),
      ...(source === "blank" ? { questions: [newQuestion("rating", [])] } : { templateId: source }),
      ...(startAt !== "" ? { startAt: toIsoOrRaw(startAt) } : {}),
      ...(endAt !== "" ? { endAt: toIsoOrRaw(endAt) } : {}),
    };
    setSubmitting(true);
    setError(null);
    const result = await createAdminSurvey(token, teamId, input);
    setSubmitting(false);
    if (result.ok) {
      onCreated(result.surveyId);
      return;
    }
    setError(validationMessage(result.error));
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      <h2 className="text-xl font-semibold text-text-primary">{builderCopy.create.heading}</h2>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-label font-medium text-text-secondary">{builderCopy.create.sourceLegend}</legend>
        <SourceOption
          value="blank"
          selected={source === "blank"}
          name={builderCopy.create.blank.name}
          description={builderCopy.create.blank.description}
          onSelect={() => setSource("blank")}
        />
        {listBuiltInTemplates().map((template) => (
          <SourceOption
            key={template.id}
            value={template.id}
            selected={source === template.id}
            name={template.name}
            description={template.description}
            onSelect={() => setSource(template.id)}
          />
        ))}
      </fieldset>

      <TextField
        id="create-title"
        label={builderCopy.create.title}
        placeholder={builderCopy.create.titlePlaceholder}
        value={title}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
      />
      <TextArea
        id="create-description"
        label={builderCopy.create.description}
        value={description}
        maxLength={1000}
        onChange={(event) => setDescription(event.target.value)}
      />

      <Select
        id="create-access-mode"
        label={builderCopy.create.accessMode}
        description={builderCopy.workspace.accessModeHint[accessMode]}
        value={accessMode}
        onChange={(event) => setAccessMode(event.target.value as "public" | "authenticated")}
      >
        <option value="public">Alle med lenken (anonymt)</option>
        <option value="authenticated">Kun innloggede medlemmer (én gang)</option>
      </Select>

      <TextField
        id="create-minimum-responses"
        type="number"
        min={MINIMUM_RESPONSES_MIN}
        max={MINIMUM_RESPONSES_MAX}
        label={builderCopy.create.minimumResponses}
        description={builderCopy.create.minimumResponsesHint}
        value={minimumResponses}
        onChange={(event) => setMinimumResponses(event.target.value)}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="create-start-at"
          type="datetime-local"
          label={builderCopy.create.startAt}
          description={builderCopy.create.startAtHint}
          value={startAt}
          onChange={(event) => setStartAt(event.target.value)}
        />
        <TextField
          id="create-end-at"
          type="datetime-local"
          label={builderCopy.create.endAt}
          value={endAt}
          onChange={(event) => setEndAt(event.target.value)}
        />
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}

      <Card as="div" variant="bordered" padding="md" className="flex flex-wrap items-center justify-end gap-3">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {builderCopy.create.cancel}
        </Button>
        <Button type="submit" pending={submitting} disabled={submitting}>
          {submitting ? builderCopy.create.submitting : builderCopy.create.submit}
        </Button>
      </Card>
    </form>
  );
}

function SourceOption({
  value,
  selected,
  name,
  description,
  onSelect,
}: {
  value: string;
  selected: boolean;
  name: string;
  description: string;
  onSelect: () => void;
}) {
  const id = `create-source-${value}`;
  return (
    <label
      htmlFor={id}
      className={
        selected
          ? "flex cursor-pointer flex-col gap-1 rounded-control border border-primary bg-primary-subtle px-4 py-3"
          : "flex cursor-pointer flex-col gap-1 rounded-control border border-border-strong px-4 py-3 hover:bg-surface-subtle"
      }
    >
      <span className="flex items-center gap-3">
        <input id={id} type="radio" name="create-source" value={value} checked={selected} onChange={onSelect} />
        <span className="text-label font-semibold text-text-primary">{name}</span>
      </span>
      <span className="pl-7 text-help text-text-muted">{description}</span>
    </label>
  );
}

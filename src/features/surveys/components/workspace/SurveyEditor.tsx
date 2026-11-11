"use client";

import { useState } from "react";
import { Alert } from "../../../../components/ui/Alert";
import { Button } from "../../../../components/ui/Button";
import { Card } from "../../../../components/ui/Card";
import { TextArea } from "../../../../components/ui/TextArea";
import { TextField } from "../../../../components/ui/TextField";
import { updateSurveyDraft } from "../../client/survey-builder-gateway";
import type { AdminSurveyEntry } from "../../client/admin-survey-gateway";
import { builderCopy, validationMessage } from "../../builder-copy";
import type { SurveyQuestion } from "../../domain/question-definitions";
import {
  addQuestion,
  draftFromSource,
  draftToPatch,
  moveQuestion,
  removeQuestion,
  toDateTimeLocal,
  updateQuestion,
  type SurveyDraft,
} from "../../domain/survey-draft";
import { QUESTION_TYPES, type QuestionType } from "../../domain/question-definitions";
import { resolveSurveyQuestions } from "../../domain/survey";
import { isEditableDraft } from "./survey-groups";
import { QuestionEditor } from "./QuestionEditor";
import { Select } from "../../../../components/ui/Select";

export interface SurveyEditorProps {
  teamId: string;
  token: string;
  survey: AdminSurveyEntry;
  /**
   * Published surveys (opened, not archived) edit only title and description
   * (team-survey-builder SPEC — "Published metadata"). Drafts edit everything.
   */
  detailsOnly: boolean;
  onSaved: () => void;
  onBack: () => void;
  onPreview: (draft: SurveyDraft) => void;
}

function initialDraft(survey: AdminSurveyEntry): SurveyDraft {
  return draftFromSource({
    title: survey.title,
    description: survey.description,
    startAt: toDateTimeLocal(survey.startAt),
    endAt: toDateTimeLocal(survey.endAt),
    questions: resolveSurveyQuestions(survey),
  });
}

type SaveStatus = { tone: "success" | "error"; text: string } | null;

/**
 * Editor for `/teams/[teamId]/surveys` (team-survey-builder TSB-005 and the
 * published-metadata change). In draft mode the whole draft is saved in one
 * request. In details mode only the title and description are sent, so the
 * server never sees question or date changes for a published survey. The
 * server enforces the same rules on every save.
 */
export function SurveyEditor({ teamId, token, survey, detailsOnly, onSaved, onBack, onPreview }: SurveyEditorProps) {
  const [draft, setDraft] = useState<SurveyDraft>(() => initialDraft(survey));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<SaveStatus>(null);
  const fullyEditable = !detailsOnly && isEditableDraft(survey);
  const canSave = fullyEditable || detailsOnly;

  function patchQuestions(update: (questions: SurveyQuestion[]) => SurveyQuestion[]) {
    setDraft((previous) => ({ ...previous, questions: update(previous.questions) }));
  }

  async function handleSave() {
    if (!canSave) {
      return;
    }
    setSaving(true);
    setStatus(null);
    const full = draftToPatch(draft);
    const patch = detailsOnly ? { title: full.title, description: full.description } : full;
    const result = await updateSurveyDraft(token, teamId, survey.surveyId, patch);
    setSaving(false);
    if (result.ok) {
      setStatus({ tone: "success", text: builderCopy.editor.saved });
      onSaved();
      return;
    }
    setStatus({ tone: "error", text: validationMessage(result.error) });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-text-primary">
          {detailsOnly ? builderCopy.editor.detailsHeading : builderCopy.editor.heading}
        </h2>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onBack}>
            {builderCopy.editor.back}
          </Button>
          {fullyEditable ? (
            <Button type="button" variant="secondary" onClick={() => onPreview(draft)}>
              {builderCopy.editor.preview}
            </Button>
          ) : null}
        </div>
      </div>

      {detailsOnly ? <Alert variant="info">{builderCopy.editor.detailsFrozen}</Alert> : null}
      {!detailsOnly && !fullyEditable ? <Alert variant="info">{builderCopy.editor.frozen}</Alert> : null}

      <Card as="section" variant="bordered" padding="md" aria-label={builderCopy.editor.heading}>
        <div className="flex flex-col gap-4">
          <TextField
            id="survey-title"
            label={builderCopy.editor.titleLabel}
            value={draft.title}
            maxLength={200}
            disabled={!canSave}
            onChange={(event) => setDraft((previous) => ({ ...previous, title: event.target.value }))}
          />
          <TextArea
            id="survey-description"
            label={builderCopy.editor.descriptionLabel}
            value={draft.description}
            maxLength={1000}
            disabled={!canSave}
            onChange={(event) => setDraft((previous) => ({ ...previous, description: event.target.value }))}
          />
          {!detailsOnly ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="survey-start-at"
                type="datetime-local"
                label={builderCopy.create.startAt}
                description={builderCopy.create.startAtHint}
                value={draft.startAt}
                disabled={!fullyEditable}
                onChange={(event) => setDraft((previous) => ({ ...previous, startAt: event.target.value }))}
              />
              <TextField
                id="survey-end-at"
                type="datetime-local"
                label={builderCopy.create.endAt}
                value={draft.endAt}
                disabled={!fullyEditable}
                onChange={(event) => setDraft((previous) => ({ ...previous, endAt: event.target.value }))}
              />
            </div>
          ) : null}
        </div>
      </Card>

      {!detailsOnly ? (
        <section aria-labelledby="questions-heading" className="flex flex-col gap-4">
          <div>
            <h3 id="questions-heading" className="text-lg font-semibold text-text-primary">
              {builderCopy.editor.questionsHeading}
            </h3>
            <p className="text-help text-text-muted">{builderCopy.editor.questionsHint}</p>
          </div>

          {draft.questions.map((question, index) => (
            <QuestionEditor
              key={question.id}
              question={question}
              index={index}
              total={draft.questions.length}
              disabled={!fullyEditable}
              onChange={(next) => patchQuestions((questions) => updateQuestion(questions, index, () => next))}
              onMove={(delta) => patchQuestions((questions) => moveQuestion(questions, index, delta))}
              onRemove={() => patchQuestions((questions) => removeQuestion(questions, index))}
            />
          ))}

          {fullyEditable ? (
            <AddQuestionControl onAdd={(type) => patchQuestions((questions) => addQuestion(questions, type))} />
          ) : null}
        </section>
      ) : null}

      {status ? <Alert variant={status.tone === "success" ? "success" : "error"}>{status.text}</Alert> : null}

      {canSave ? (
        <div>
          <Button type="button" onClick={handleSave} pending={saving} disabled={saving}>
            {saving ? builderCopy.editor.saving : builderCopy.editor.save}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function AddQuestionControl({ onAdd }: { onAdd: (type: QuestionType) => void }) {
  const [type, setType] = useState<QuestionType>("rating");
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-56">
        <Select
          id="new-question-type"
          label={builderCopy.editor.type}
          value={type}
          onChange={(event) => setType(event.target.value as QuestionType)}
        >
          {QUESTION_TYPES.map((item) => (
            <option key={item} value={item}>
              {builderCopy.questionTypes[item]}
            </option>
          ))}
        </Select>
      </div>
      <Button type="button" variant="secondary" onClick={() => onAdd(type)}>
        {builderCopy.editor.addQuestion}
      </Button>
    </div>
  );
}

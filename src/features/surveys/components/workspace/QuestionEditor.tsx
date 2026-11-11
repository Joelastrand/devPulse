"use client";

import { Button } from "../../../../components/ui/Button";
import { Card } from "../../../../components/ui/Card";
import { Select } from "../../../../components/ui/Select";
import { TextField } from "../../../../components/ui/TextField";
import { builderCopy } from "../../builder-copy";
import { QUESTION_TYPES, type QuestionType, type SurveyQuestion } from "../../domain/question-definitions";
import {
  changeQuestionType,
  addOption,
  removeOption,
  renameOption,
} from "../../domain/survey-draft";

export interface QuestionEditorProps {
  question: SurveyQuestion;
  index: number;
  total: number;
  disabled: boolean;
  onChange: (question: SurveyQuestion) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}

/**
 * Edits one question in the draft editor (team-survey-builder TSB-005). Only
 * the draft's own state changes here. Every save is validated again on the
 * server, which is authoritative.
 */
export function QuestionEditor({ question, index, total, disabled, onChange, onMove, onRemove }: QuestionEditorProps) {
  const baseId = `question-${question.id}`;
  const isChoice = question.type === "single_choice" || question.type === "multiple_choice";
  const number = index + 1;

  return (
    <Card as="section" variant="bordered" padding="md" aria-label={builderCopy.editor.questionNumber(number)}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <TextField
              id={`${baseId}-prompt`}
              label={builderCopy.editor.prompt}
              value={question.prompt}
              maxLength={500}
              disabled={disabled}
              onChange={(event) => onChange({ ...question, prompt: event.target.value })}
            />
          </div>
          <div className="w-48">
            <Select
              id={`${baseId}-type`}
              label={builderCopy.editor.type}
              value={question.type}
              disabled={disabled}
              onChange={(event) => onChange(changeQuestionType(question, event.target.value as QuestionType))}
            >
              {QUESTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {builderCopy.questionTypes[type]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="inline-flex items-center gap-2 text-label text-text-secondary">
            <input
              type="checkbox"
              checked={question.required}
              disabled={disabled || question.type === "free_text"}
              onChange={(event) => onChange({ ...question, required: event.target.checked })}
            />
            {builderCopy.editor.required}
          </label>
          {question.type === "free_text" ? (
            <p className="text-help text-text-muted">{builderCopy.editor.requiredHint}</p>
          ) : null}
        </div>

        {isChoice ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="text-label font-medium text-text-secondary">{builderCopy.editor.options}</legend>
            {question.options.map((option, optionIndex) => (
              <div key={option.id} className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <TextField
                    id={`${baseId}-option-${option.id}`}
                    label={builderCopy.editor.optionLabel(optionIndex + 1)}
                    value={option.label}
                    maxLength={200}
                    disabled={disabled}
                    onChange={(event) => onChange(renameOption(question, optionIndex, event.target.value))}
                  />
                </div>
                <Button
                  type="button"
                  variant="tertiary"
                  size="sm"
                  disabled={disabled || question.options.length <= 2}
                  onClick={() => onChange(removeOption(question, optionIndex))}
                >
                  {builderCopy.editor.removeOption}
                </Button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={disabled || question.options.length >= 10}
                onClick={() => onChange(addOption(question))}
              >
                {builderCopy.editor.addOption}
              </Button>
            </div>
          </fieldset>
        ) : null}

        {question.type === "free_text" ? (
          <div className="w-48">
            <TextField
              id={`${baseId}-maxlength`}
              label={builderCopy.editor.maxLength}
              type="number"
              min={1}
              max={1000}
              value={question.maxLength}
              disabled={disabled}
              onChange={(event) => onChange({ ...question, maxLength: Number(event.target.value) })}
            />
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={disabled || index === 0} onClick={() => onMove(-1)}>
            {builderCopy.editor.moveUp}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || index >= total - 1}
            onClick={() => onMove(1)}
          >
            {builderCopy.editor.moveDown}
          </Button>
          <Button type="button" variant="destructive" size="sm" disabled={disabled || total <= 1} onClick={onRemove}>
            {builderCopy.editor.remove}
          </Button>
        </div>
      </div>
    </Card>
  );
}

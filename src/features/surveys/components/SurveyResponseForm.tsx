"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { cx } from "../../../components/ui/class-names";
import { Icon } from "../../../components/ui/Icon";
import { TextArea } from "../../../components/ui/TextArea";
import { CompletionIllustration } from "../../../components/ui/illustrations/illustrations";
import { submitSurveyResponse, type SurveyAnswerPayload } from "../client/submit-survey-response-gateway";
import { builderCopy } from "../builder-copy";
import { surveysCopy } from "../copy";
import type { SurveyQuestion } from "../domain/question-definitions";

/** One respondent's in-memory answer to one question. Never persisted by the client. */
export type DraftAnswer = number | string | string[] | undefined;

export interface SurveyResponseFormProps {
  surveyId: string;
  /** The caller's Firebase ID token, or `null` when signed out. Forwarded only for `authenticated` surveys. */
  idToken: string | null;
  questions: SurveyQuestion[];
  /** `preview` shows the same steps but never submits. Used by the team workspace. */
  mode?: "respond" | "preview";
}

type Status = "idle" | "submitting" | "success" | "already_submitted" | "error";

const SCALE = [1, 2, 3, 4, 5] as const;

/** Whether a question has an answer that counts for the "Next" gate and for submission. */
export function isAnswered(question: SurveyQuestion, value: DraftAnswer): boolean {
  switch (question.type) {
    case "rating":
      return typeof value === "number";
    case "single_choice":
      return typeof value === "string" && value.length > 0;
    case "multiple_choice":
      return Array.isArray(value) && value.length > 0;
    case "free_text":
      return typeof value === "string" && value.trim().length > 0;
  }
}

/**
 * The payload sent to the server: only questions that actually have an answer.
 * An optional question left blank is omitted, never sent as an empty value.
 */
export function buildPayload(
  questions: readonly SurveyQuestion[],
  answers: Record<string, DraftAnswer>,
): SurveyAnswerPayload {
  const payload: Record<string, number | string | string[]> = {};
  for (const question of questions) {
    const value = answers[question.id];
    if (isAnswered(question, value) && value !== undefined) {
      payload[question.id] = value as number | string | string[];
    }
  }
  return payload;
}

function summarize(question: SurveyQuestion, value: DraftAnswer): string {
  if (!isAnswered(question, value)) {
    return "—";
  }
  if (question.type === "single_choice" || question.type === "multiple_choice") {
    const selected = Array.isArray(value) ? value : [value];
    return selected
      .map((id) => question.options.find((option) => option.id === id)?.label ?? "")
      .filter((label) => label.length > 0)
      .join(", ");
  }
  return String(value);
}

/**
 * The form for answering any survey (team-survey-builder TSB-007). One
 * question per screen, with a review step, as before. Required questions gate
 * "Next". Optional questions can be skipped. Free text always shows the
 * re-identification warning. Server-side validation, lifecycle, and
 * authorization remain authoritative for every submission.
 */
export function SurveyResponseForm({ surveyId, idToken, questions, mode = "respond" }: SurveyResponseFormProps) {
  const [answers, setAnswers] = useState<Record<string, DraftAnswer>>({});
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<Status>("idle");

  const reviewStep = questions.length;
  const currentQuestion = step < reviewStep ? questions[step] : null;
  const currentAnswered = currentQuestion
    ? !currentQuestion.required || isAnswered(currentQuestion, answers[currentQuestion.id])
    : true;
  const allRequiredAnswered = questions.every(
    (question) => !question.required || isAnswered(question, answers[question.id]),
  );

  function setAnswer(question: SurveyQuestion, value: DraftAnswer) {
    setAnswers((previous) => ({ ...previous, [question.id]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "preview" || !allRequiredAnswered) {
      return;
    }
    setStatus("submitting");
    const result = await submitSurveyResponse(surveyId, buildPayload(questions, answers), idToken ?? undefined);
    if (result.status === "ok") {
      setStatus("success");
      return;
    }
    setStatus(result.status === "already_submitted" ? "already_submitted" : "error");
  }

  if (status === "success") {
    return (
      <div className="mt-6 flex flex-col items-start gap-4">
        <CompletionIllustration />
        <Alert variant="success">{surveysCopy.form.success}</Alert>
      </div>
    );
  }

  if (status === "already_submitted") {
    return (
      <Alert variant="info" className="mt-6">
        {surveysCopy.form.alreadySubmitted}
      </Alert>
    );
  }

  const progressPercent = Math.round((Math.min(step, questions.length) / Math.max(questions.length, 1)) * 100);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      {mode === "preview" ? <Alert variant="info">{builderCopy.respond.previewBanner}</Alert> : null}

      <div className="flex flex-col gap-2">
        <p className="text-label font-medium text-text-secondary">
          {currentQuestion
            ? surveysCopy.form.stepper.progress(step + 1, questions.length)
            : surveysCopy.form.stepper.review}
        </p>
        <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-field bg-surface-subtle">
          <div
            className="h-2 bg-primary transition-[width] duration-progress ease-standard"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {currentQuestion ? (
        <QuestionStep question={currentQuestion} value={answers[currentQuestion.id]} onChange={(value) => setAnswer(currentQuestion, value)} />
      ) : null}

      {currentQuestion ? (
        <div className="flex flex-col gap-3">
          {!currentAnswered ? (
            <p id="survey-next-hint" className="text-help text-text-muted">
              {surveysCopy.form.stepper.nextDisabled}
            </p>
          ) : null}
          <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t border-border-subtle bg-surface px-4 py-3 md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0">
            <Button type="button" variant="secondary" onClick={() => setStep((previous) => Math.max(previous - 1, 0))} disabled={step === 0}>
              {surveysCopy.form.stepper.back}
            </Button>
            <Button
              type="button"
              onClick={() => setStep((previous) => Math.min(previous + 1, reviewStep))}
              disabled={!currentAnswered}
              aria-describedby={!currentAnswered ? "survey-next-hint" : undefined}
            >
              <span className="inline-flex items-center gap-2">
                {surveysCopy.form.stepper.next}
                <Icon icon={ArrowRight} size="inline" />
              </span>
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <ul aria-label={surveysCopy.form.stepper.review} className="flex flex-col gap-3">
            {questions.map((question) => (
              <li key={question.id} className="flex items-center justify-between gap-3 rounded-control border border-border-subtle px-4 py-3">
                <span className="text-label text-text-secondary">{question.prompt}</span>
                <span className="text-right text-label font-semibold text-text-primary">{summarize(question, answers[question.id])}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3">
            <Button type="button" variant="secondary" onClick={() => setStep((previous) => Math.max(previous - 1, 0))}>
              {surveysCopy.form.stepper.back}
            </Button>
            <Button type="submit" disabled={!allRequiredAnswered || mode === "preview"} pending={status === "submitting"}>
              {status === "submitting" ? surveysCopy.form.submitting : surveysCopy.form.submit}
            </Button>
          </div>
        </div>
      )}

      {status === "error" && (
        <Alert variant="error" className="text-sm">
          {surveysCopy.form.error}
        </Alert>
      )}
    </form>
  );
}

function QuestionStep({
  question,
  value,
  onChange,
}: {
  question: SurveyQuestion;
  value: DraftAnswer;
  onChange: (value: DraftAnswer) => void;
}) {
  return (
    <Card as="div" variant="bordered" padding="md">
      <fieldset key={question.id} className="flex flex-col gap-4">
        <legend className="text-survey-question font-semibold text-text-primary">{question.prompt}</legend>
        <p className="text-help text-text-muted">{question.required ? builderCopy.respond.required : builderCopy.respond.optional}</p>

        {question.type === "rating" ? (
          <OptionList
            name={question.id}
            inputType="radio"
            options={SCALE.map((n) => ({ id: String(n), label: String(n) }))}
            selected={typeof value === "number" ? [String(value)] : []}
            onSelect={(id) => onChange(Number(id))}
          />
        ) : null}

        {question.type === "single_choice" ? (
          <OptionList
            name={question.id}
            inputType="radio"
            options={question.options}
            selected={typeof value === "string" ? [value] : []}
            onSelect={(id) => onChange(id)}
          />
        ) : null}

        {question.type === "multiple_choice" ? (
          <>
            <p className="text-help text-text-muted">{builderCopy.respond.multipleHint}</p>
            <OptionList
              name={question.id}
              inputType="checkbox"
              options={question.options}
              selected={Array.isArray(value) ? value : []}
              onSelect={(id) => {
                const current = Array.isArray(value) ? value : [];
                onChange(current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
              }}
            />
          </>
        ) : null}

        {question.type === "free_text" ? (
          <>
            <Alert variant="info">{builderCopy.respond.freeTextWarning}</Alert>
            <TextArea
              id={`free-text-${question.id}`}
              label={question.prompt}
              value={typeof value === "string" ? value : ""}
              maxLength={question.maxLength}
              placeholder={builderCopy.respond.textPlaceholder}
              onChange={(event) => onChange(event.target.value)}
              description={builderCopy.respond.charCount(
                typeof value === "string" ? value.length : 0,
                question.maxLength,
              )}
            />
          </>
        ) : null}
      </fieldset>
    </Card>
  );
}

function OptionList({
  name,
  inputType,
  options,
  selected,
  onSelect,
}: {
  name: string;
  inputType: "radio" | "checkbox";
  options: readonly { id: string; label: string }[];
  selected: readonly string[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {options.map((option) => {
        const inputId = `${name}-${option.id}`;
        const isSelected = selected.includes(option.id);
        return (
          <label
            key={option.id}
            htmlFor={inputId}
            className={cx(
              "flex min-h-11 min-w-11 w-full cursor-pointer items-center gap-3 rounded-control border px-4 py-3 text-label font-medium transition-colors duration-micro ease-standard has-focus-visible:outline has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring",
              isSelected ? "border-primary text-primary bg-primary-subtle" : "border-border-strong text-text-secondary hover:bg-surface-subtle",
            )}
          >
            <input
              id={inputId}
              type={inputType}
              name={name}
              value={option.id}
              checked={isSelected}
              onChange={() => onSelect(option.id)}
              className="sr-only"
            />
            <span
              aria-hidden="true"
              className={cx(
                "flex size-5 shrink-0 items-center justify-center border-2",
                inputType === "radio" ? "rounded-full" : "rounded-control",
                isSelected ? "border-primary" : "border-border-strong",
              )}
            >
              {isSelected ? <span className={cx("size-2.5 bg-primary", inputType === "radio" ? "rounded-full" : "rounded-sm")} /> : null}
            </span>
            {option.label}
          </label>
        );
      })}
    </div>
  );
}

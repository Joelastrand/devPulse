"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { CompletionIllustration } from "../../../components/ui/illustrations/illustrations";
import { cx } from "../../../components/ui/class-names";
import { submitSurveyResponse } from "../client/submit-survey-response-gateway";
import { surveysCopy } from "../copy";

export interface SurveyResponseFormProps {
  surveyId: string;
  /** The caller's current Firebase ID token, or `null` when signed out — forwarded only for `authenticated` surveys; a `public` survey ignores it. */
  idToken: string | null;
}

const QUESTIONS = [
  { id: "flow", label: surveysCopy.questions.flow },
  { id: "stress", label: surveysCopy.questions.stress },
  { id: "fun", label: surveysCopy.questions.fun },
] as const;

type QuestionId = (typeof QUESTIONS)[number]["id"];

const SCALE = [1, 2, 3, 4, 5] as const;

/** Steps 0 to 2 are the questions; the step after the last question is the review. */
const REVIEW_STEP = QUESTIONS.length;

type Status = "idle" | "submitting" | "success" | "already_submitted" | "error";

/**
 * The `answerable`-only submission form for `/survey/{surveyId}`
 * (docs/features/managed-surveys/SPEC.md — TASK-007). Client-side
 * completeness is a UX convenience only; TASK-006's server-side
 * authorization/lifecycle/dedup decision is authoritative regardless of
 * what this component allows or shows beforehand
 * (`.claude/rules/security.md`). New code, deliberately not imported from
 * `src/features/pulse-survey/`, which is retired wholesale later
 * (TASK-014) — visually consistent with `PulseSurveyForm`, but without a
 * team selector: `teamId` is never client-supplied for this model.
 *
 * One question is shown at a time (docs/features/product-experience/SPEC.md —
 * BR-S2, BR-S3, BR-S5). Answers live in memory for the page session only, so
 * Back and Next keep them and nothing is stored.
 */
export function SurveyResponseForm({ surveyId, idToken }: SurveyResponseFormProps) {
  const [answers, setAnswers] = useState<Record<QuestionId, number | null>>({
    flow: null,
    stress: null,
    fun: null,
  });
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<Status>("idle");

  const isComplete = QUESTIONS.every((question) => answers[question.id] !== null);
  const currentQuestion = step < REVIEW_STEP ? QUESTIONS[step] : null;
  const currentAnswered = currentQuestion ? answers[currentQuestion.id] !== null : true;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isComplete) {
      return;
    }

    setStatus("submitting");

    const result = await submitSurveyResponse(
      surveyId,
      QUESTIONS.map((question) => answers[question.id] as number),
      idToken ?? undefined,
    );

    if (result.status === "ok") {
      setStatus("success");
      return;
    }

    setStatus(result.status === "already_submitted" ? "already_submitted" : "error");
  }

  function goNext() {
    if (!currentAnswered) {
      return;
    }
    setStep((previous) => Math.min(previous + 1, REVIEW_STEP));
  }

  function goBack() {
    setStep((previous) => Math.max(previous - 1, 0));
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

  const progressPercent = Math.round((Math.min(step, QUESTIONS.length) / QUESTIONS.length) * 100);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      <div className="flex flex-col gap-2">
        <p className="text-label font-medium text-text-secondary">
          {currentQuestion
            ? surveysCopy.form.stepper.progress(step + 1, QUESTIONS.length)
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
        <fieldset key={currentQuestion.id} className="flex flex-col gap-2">
          <legend className="text-survey-question font-semibold text-text-primary">
            {currentQuestion.label}
          </legend>
          <div className="flex gap-4">
            {SCALE.map((value) => {
              const inputId = `${currentQuestion.id}-${value}`;
              return (
                <label
                  key={value}
                  htmlFor={inputId}
                  className={cx(
                    "flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-control border text-label font-medium transition-colors duration-micro ease-standard has-focus-visible:outline has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring",
                    answers[currentQuestion.id] === value
                      ? "border-primary text-primary bg-primary-subtle"
                      : "border-border-strong text-text-secondary hover:bg-surface-subtle",
                  )}
                >
                  <input
                    id={inputId}
                    type="radio"
                    name={currentQuestion.id}
                    value={value}
                    checked={answers[currentQuestion.id] === value}
                    onChange={() =>
                      setAnswers((previous) => ({
                        ...previous,
                        [currentQuestion.id]: value,
                      }))
                    }
                    className="sr-only"
                  />
                  {value}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {currentQuestion ? (
        <div className="flex flex-col gap-3">
          {!currentAnswered ? (
            <p id="survey-next-hint" className="text-help text-text-muted">
              {surveysCopy.form.stepper.nextDisabled}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <Button type="button" variant="secondary" onClick={goBack} disabled={step === 0}>
              {surveysCopy.form.stepper.back}
            </Button>
            <Button
              type="button"
              onClick={goNext}
              disabled={!currentAnswered}
              aria-describedby={!currentAnswered ? "survey-next-hint" : undefined}
            >
              {surveysCopy.form.stepper.next}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <ul aria-label={surveysCopy.form.stepper.review} className="flex flex-col gap-3">
            {QUESTIONS.map((question) => (
              <li key={question.id} className="flex items-center justify-between gap-3 rounded-control border border-border-subtle px-4 py-3">
                <span className="text-label text-text-secondary">{question.label}</span>
                <span className="text-label font-semibold text-text-primary">{answers[question.id]}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3">
            <Button type="button" variant="secondary" onClick={goBack}>
              {surveysCopy.form.stepper.back}
            </Button>
            <Button type="submit" disabled={!isComplete} pending={status === "submitting"}>
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

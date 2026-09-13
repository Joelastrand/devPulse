"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
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
 */
export function SurveyResponseForm({ surveyId, idToken }: SurveyResponseFormProps) {
  const [answers, setAnswers] = useState<Record<QuestionId, number | null>>({
    flow: null,
    stress: null,
    fun: null,
  });
  const [status, setStatus] = useState<Status>("idle");

  const isComplete = QUESTIONS.every((question) => answers[question.id] !== null);

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

  if (status === "success") {
    return (
      <Alert variant="success" className="mt-6">
        {surveysCopy.form.success}
      </Alert>
    );
  }

  if (status === "already_submitted") {
    return (
      <Alert variant="info" className="mt-6">
        {surveysCopy.form.alreadySubmitted}
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      {QUESTIONS.map((question) => (
        <fieldset key={question.id} className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {question.label}
          </legend>
          <div className="flex gap-4">
            {SCALE.map((value) => {
              const inputId = `${question.id}-${value}`;
              return (
                <label
                  key={value}
                  htmlFor={inputId}
                  className="flex flex-col items-center gap-1 text-sm text-zinc-700 dark:text-zinc-300"
                >
                  <input
                    id={inputId}
                    type="radio"
                    name={question.id}
                    value={value}
                    checked={answers[question.id] === value}
                    onChange={() =>
                      setAnswers((previous) => ({
                        ...previous,
                        [question.id]: value,
                      }))
                    }
                    className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  />
                  {value}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      <Button type="submit" disabled={!isComplete} pending={status === "submitting"}>
        {status === "submitting" ? surveysCopy.form.submitting : surveysCopy.form.submit}
      </Button>

      {status === "error" && (
        <Alert variant="error" className="text-sm">
          {surveysCopy.form.error}
        </Alert>
      )}
    </form>
  );
}

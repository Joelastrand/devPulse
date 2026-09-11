"use client";

import { useState, type FormEvent } from "react";

export interface PulseSurveyTeamOption {
  teamId: string;
  name: string;
}

export interface PulseSurveyFormProps {
  /** The currently active teams, server-fetched from Firestore (BR-31). */
  teams: PulseSurveyTeamOption[];
  /** True when the active-team read failed closed; never falls back to a static list. */
  teamsUnavailable?: boolean;
}

const QUESTIONS = [
  { id: "flow", label: "Flow / delivery satisfaction" },
  { id: "stress", label: "Stress / sustainable workload" },
  { id: "fun", label: "Fun / motivation" },
] as const;

type QuestionId = (typeof QUESTIONS)[number]["id"];

const SCALE = [1, 2, 3, 4, 5] as const;

type Status = "idle" | "submitting" | "success" | "error";

/**
 * Client-side completeness is a UX convenience only; TASK-003's server-side
 * validation is authoritative regardless of what this component allows.
 */
export function PulseSurveyForm({ teams, teamsUnavailable = false }: PulseSurveyFormProps) {
  const [answers, setAnswers] = useState<Record<QuestionId, number | null>>({
    flow: null,
    stress: null,
    fun: null,
  });
  const [teamId, setTeamId] = useState<string>("");
  const [status, setStatus] = useState<Status>("idle");

  const isComplete =
    !teamsUnavailable &&
    QUESTIONS.every((question) => answers[question.id] !== null) &&
    teamId !== "";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isComplete) {
      return;
    }

    setStatus("submitting");

    try {
      const response = await fetch("/api/pulse-survey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          answers: QUESTIONS.map((question) => answers[question.id]),
          teamId,
        }),
      });
      setStatus(response.ok ? "success" : "error");
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <p role="status" className="mt-6 text-zinc-900 dark:text-zinc-50">
        Thanks — your response was recorded.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-6" noValidate>
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

      <div className="flex flex-col gap-2">
        <label
          htmlFor="pulse-survey-team"
          className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
        >
          Team
        </label>
        <select
          id="pulse-survey-team"
          name="teamId"
          value={teamId}
          onChange={(event) => setTeamId(event.target.value)}
          disabled={teamsUnavailable}
          className="rounded border border-zinc-300 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="" disabled>
            Select your team
          </option>
          {teams.map((team) => (
            <option key={team.teamId} value={team.teamId}>
              {team.name}
            </option>
          ))}
        </select>
        {teamsUnavailable && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            The team list is currently unavailable. Please try again later.
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={!isComplete || status === "submitting"}
        className="rounded-full bg-foreground px-5 py-2.5 text-background transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "submitting" ? "Submitting…" : "Submit"}
      </button>

      {status === "error" && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          Something went wrong. Please try again.
        </p>
      )}
    </form>
  );
}

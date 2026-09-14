"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { submitChallenge } from "../client/challenges-gateway";
import { challengesCopy } from "../copy";
import { CHALLENGE_TEXT_MAX_LENGTH, CHALLENGE_TEXT_MIN_LENGTH } from "../domain/challenge-text";

export interface ChallengeSubmissionPanelProps {
  idToken: string;
  teamId: string;
  /** Invoked after a successful submission so the caller can refresh the challenge list through the existing server contract — this component never fabricates a challenge DTO of its own. */
  onSubmitted: () => void;
}

type SubmissionPhase =
  | "idle"
  | "submitting"
  | "success"
  | "validation_error"
  | "team_disabled_error"
  | "error";

function isValidLength(rawText: string): boolean {
  const trimmed = rawText.trim();
  return trimmed.length >= CHALLENGE_TEXT_MIN_LENGTH && trimmed.length <= CHALLENGE_TEXT_MAX_LENGTH;
}

/**
 * `/teams/[teamId]`'s "Meld en utfordring" panel (docs/features/
 * anonymous-challenges/SPEC.md — BR-27, BR-28, BR-32). Sends only the
 * free-text body to the server — no uid/email/displayName/membershipId/
 * admin-state field of any kind; `submitChallenge`'s server operation
 * derives identity and team eligibility entirely on its own
 * (`.claude/rules/security.md`).
 *
 * Client-side length validation mirrors TASK-001's bounds as a usability aid
 * only — the server call remains independently authoritative (mirrors the
 * existing `minimumResponses` "client bound is not a security control"
 * precedent); a server-side `invalid_input` result is handled identically to
 * the client-side check.
 *
 * `sign_in_required`/`forbidden`/`team_not_found`/`encryption_failed`/
 * `persistence_failed`/`read_failed` all collapse into one generic,
 * controlled infrastructure-failure message — the distinction between e.g.
 * `encryption_failed` and `persistence_failed` is never exposed to the user
 * (mirrors TASK-002's outcome-minimization posture). `team_disabled` gets
 * its own accurate message, since it reflects a real, SPEC-documented
 * submission restriction (docs/features/anonymous-challenges/SPEC.md —
 * "Team-disable semantics") rather than an infrastructure failure — this
 * component never infers a disabled team client-side beforehand; it only
 * ever reports what the server actually decided.
 *
 * After a successful submission, focus moves to the confirmation itself
 * (a focusable, `tabIndex={-1}` container around the `Alert`) so
 * keyboard/screen-reader users get a clear, immediate confirmation rather
 * than focus being left on a now-unmounted textarea.
 */
export function ChallengeSubmissionPanel({ idToken, teamId, onSubmitted }: ChallengeSubmissionPanelProps) {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<SubmissionPhase>("idle");
  const successRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (phase === "success") {
      successRef.current?.focus();
    }
  }, [phase]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isValidLength(text)) {
      setPhase("validation_error");
      return;
    }

    setPhase("submitting");
    const result = await submitChallenge(idToken, teamId, text);

    if (result.status === "ok") {
      setText("");
      setPhase("success");
      onSubmitted();
      return;
    }

    if (result.status === "invalid_input") {
      setPhase("validation_error");
      return;
    }

    if (result.status === "team_disabled") {
      setPhase("team_disabled_error");
      return;
    }

    setPhase("error");
  }

  if (phase === "success") {
    return (
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {challengesCopy.submission.heading}
        </h3>
        <div ref={successRef} tabIndex={-1}>
          <Alert variant="success">{challengesCopy.submission.success}</Alert>
        </div>
      </div>
    );
  }

  const isSubmitting = phase === "submitting";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        {challengesCopy.submission.heading}
      </h3>
      <p id="challenge-text-description" className="text-sm text-zinc-600 dark:text-zinc-400">
        {challengesCopy.submission.explanation} {challengesCopy.submission.identityWarning}
      </p>

      <div className="flex flex-col gap-1">
        <label htmlFor="challenge-text" className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {challengesCopy.submission.textareaLabel}
        </label>
        <textarea
          id="challenge-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={challengesCopy.submission.textareaPlaceholder}
          rows={4}
          aria-describedby={
            phase === "validation_error"
              ? "challenge-text-description challenge-validation-error"
              : "challenge-text-description"
          }
          aria-invalid={phase === "validation_error" || undefined}
          className="rounded-lg border border-zinc-300 bg-transparent p-3 text-sm text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:text-zinc-50"
        />
      </div>

      {phase === "validation_error" && (
        <Alert variant="error" id="challenge-validation-error">
          {challengesCopy.submission.validationError}
        </Alert>
      )}
      {phase === "team_disabled_error" && (
        <Alert variant="error">{challengesCopy.submission.teamDisabledError}</Alert>
      )}
      {phase === "error" && <Alert variant="error">{challengesCopy.submission.genericError}</Alert>}

      <Button type="submit" pending={isSubmitting} className="w-fit">
        {isSubmitting ? challengesCopy.submission.submitting : challengesCopy.submission.submit}
      </Button>
    </form>
  );
}

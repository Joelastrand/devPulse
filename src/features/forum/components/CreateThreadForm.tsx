"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { createThread } from "../client/forum-gateway";
import { forumCopy } from "../copy";
import {
  THREAD_BODY_MAX_LENGTH,
  THREAD_BODY_MIN_LENGTH,
  THREAD_TITLE_MAX_LENGTH,
  THREAD_TITLE_MIN_LENGTH,
} from "../domain/thread-content";

export interface CreateThreadFormProps {
  idToken: string;
  teamId: string;
  /** Invoked with the server-generated `threadId` after a successful creation, so the caller can navigate to the new thread's detail view (SPEC "Product behavior" #2) — this component never fabricates a thread DTO of its own. */
  onCreated: (threadId: string) => void;
}

type CreatePhase = "idle" | "submitting" | "success" | "validation_error" | "team_disabled_error" | "error";

function isValidLength(rawValue: string, min: number, max: number): boolean {
  const trimmed = rawValue.trim();
  return trimmed.length >= min && trimmed.length <= max;
}

/**
 * `/teams/[teamId]`'s "Start en ny tråd" form (docs/features/team-forum/
 * SPEC.md — BR-37, BR-43, BR-44). Sends only `title`/`body` — no
 * uid/email/teamId-override/lifecycle field of any kind; `createThread`'s
 * server operation derives identity and team eligibility entirely on its
 * own (`.claude/rules/security.md`).
 *
 * Client-side length validation mirrors BR-3's bounds as a usability aid
 * only — the server call remains independently authoritative (mirrors
 * `ChallengeSubmissionPanel`'s identical "client bound is not a security
 * control" precedent).
 *
 * Rendered for any team-page-authorized viewer (mirrors
 * `ChallengeSubmissionPanel`'s established precedent — TeamDetail does not
 * itself distinguish a real member from an app-admin-without-membership,
 * since no such client-observable signal exists yet); an app admin with no
 * real membership sees the server's own `forbidden` response surface as the
 * generic error below, never a fabricated client-side membership check
 * (BR-1 remains a server-only decision).
 */
export function CreateThreadForm({ idToken, teamId, onCreated }: CreateThreadFormProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [phase, setPhase] = useState<CreatePhase>("idle");
  const successRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (phase === "success") {
      successRef.current?.focus();
    }
  }, [phase]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      !isValidLength(title, THREAD_TITLE_MIN_LENGTH, THREAD_TITLE_MAX_LENGTH) ||
      !isValidLength(body, THREAD_BODY_MIN_LENGTH, THREAD_BODY_MAX_LENGTH)
    ) {
      setPhase("validation_error");
      return;
    }

    setPhase("submitting");
    const result = await createThread(idToken, teamId, title.trim(), body.trim());

    if (result.status === "ok") {
      setPhase("success");
      onCreated(result.threadId);
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
      <div ref={successRef} tabIndex={-1}>
        <Alert variant="success">{forumCopy.createThread.success}</Alert>
      </div>
    );
  }

  const isSubmitting = phase === "submitting";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{forumCopy.createThread.heading}</h3>

      <div className="flex flex-col gap-1">
        <label htmlFor="forum-thread-title" className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {forumCopy.createThread.titleLabel}
        </label>
        <input
          id="forum-thread-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={forumCopy.createThread.titlePlaceholder}
          aria-describedby={phase === "validation_error" ? "forum-thread-validation-error" : undefined}
          aria-invalid={phase === "validation_error" || undefined}
          className="rounded-lg border border-zinc-300 bg-transparent p-3 text-sm text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:text-zinc-50"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="forum-thread-body" className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {forumCopy.createThread.bodyLabel}
        </label>
        <textarea
          id="forum-thread-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={forumCopy.createThread.bodyPlaceholder}
          rows={4}
          aria-describedby={phase === "validation_error" ? "forum-thread-validation-error" : undefined}
          aria-invalid={phase === "validation_error" || undefined}
          className="rounded-lg border border-zinc-300 bg-transparent p-3 text-sm text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:text-zinc-50"
        />
      </div>

      {phase === "validation_error" && (
        <Alert variant="error" id="forum-thread-validation-error">
          {forumCopy.createThread.validationError}
        </Alert>
      )}
      {phase === "team_disabled_error" && <Alert variant="error">{forumCopy.createThread.teamDisabledError}</Alert>}
      {phase === "error" && <Alert variant="error">{forumCopy.createThread.genericError}</Alert>}

      <Button type="submit" pending={isSubmitting} className="w-fit">
        {isSubmitting ? forumCopy.createThread.submitting : forumCopy.createThread.submit}
      </Button>
    </form>
  );
}

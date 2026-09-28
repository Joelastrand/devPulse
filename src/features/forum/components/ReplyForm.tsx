"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { TextArea } from "../../../components/ui/TextArea";
import { createReply } from "../client/forum-gateway";
import { forumCopy } from "../copy";
import { REPLY_BODY_MAX_LENGTH, REPLY_BODY_MIN_LENGTH } from "../domain/reply-content";

export interface ReplyFormProps {
  idToken: string;
  teamId: string;
  threadId: string;
  /** Invoked after a successful reply so the caller can refresh the thread through the existing server contract (authoritative refresh, mirrors `TeamDetail.handleChallengeSubmitted`) — this component never fabricates a reply DTO of its own. */
  onSubmitted: () => void;
}

type ReplyPhase = "idle" | "submitting" | "success" | "validation_error" | "thread_full" | "error";

function isValidLength(rawValue: string): boolean {
  const trimmed = rawValue.trim();
  return trimmed.length >= REPLY_BODY_MIN_LENGTH && trimmed.length <= REPLY_BODY_MAX_LENGTH;
}

/**
 * A thread's reply-submission panel (docs/features/team-forum/SPEC.md —
 * BR-38, BR-43, BR-44). Sends only the reply body — no identity/scope/
 * lifecycle field of any kind; `createReply` derives everything else
 * server-side.
 *
 * **Never re-implements the 500-reply capacity check** (this task must not
 * duplicate BR-52's server-side limit — `../../../server/create-reply.ts`
 * is `server-only` and its `REPLY_CAPACITY_LIMIT` cannot be imported into
 * client code regardless). Capacity is discovered reactively: once a
 * submission attempt actually returns `thread_full`, this component renders
 * a disabled, explanatory state instead of the form for the remainder of
 * this mount — it never pre-computes fullness from a locally-counted reply
 * list.
 */
export function ReplyForm({ idToken, teamId, threadId, onSubmitted }: ReplyFormProps) {
  const [body, setBody] = useState("");
  const [phase, setPhase] = useState<ReplyPhase>("idle");
  const successRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (phase === "success") {
      successRef.current?.focus();
    }
  }, [phase]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isValidLength(body)) {
      setPhase("validation_error");
      return;
    }

    setPhase("submitting");
    const result = await createReply(idToken, teamId, threadId, body.trim());

    if (result.status === "ok") {
      setBody("");
      setPhase("success");
      onSubmitted();
      return;
    }

    if (result.status === "invalid_input") {
      setPhase("validation_error");
      return;
    }

    if (result.status === "thread_full") {
      setPhase("thread_full");
      return;
    }

    setPhase("error");
  }

  if (phase === "thread_full") {
    return <Alert variant="info">{forumCopy.replyForm.threadFull}</Alert>;
  }

  if (phase === "success") {
    return (
      <div className="flex flex-col gap-3">
        <div ref={successRef} tabIndex={-1}>
          <Alert variant="success">{forumCopy.replyForm.success}</Alert>
        </div>
        <Button variant="secondary" size="sm" className="w-fit" onClick={() => setPhase("idle")}>
          {forumCopy.replyForm.replyAgain}
        </Button>
      </div>
    );
  }

  const isSubmitting = phase === "submitting";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{forumCopy.replyForm.heading}</h3>

      <TextArea
        id="forum-reply-body"
        label={forumCopy.replyForm.bodyLabel}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={forumCopy.replyForm.bodyPlaceholder}
        rows={3}
        aria-describedby={phase === "validation_error" ? "forum-reply-validation-error" : undefined}
        aria-invalid={phase === "validation_error" || undefined}
      />

      {phase === "validation_error" && (
        <Alert variant="error" id="forum-reply-validation-error">
          {forumCopy.replyForm.validationError}
        </Alert>
      )}
      {phase === "error" && <Alert variant="error">{forumCopy.replyForm.genericError}</Alert>}

      <Button type="submit" pending={isSubmitting} className="w-fit">
        {isSubmitting ? forumCopy.replyForm.submitting : forumCopy.replyForm.submit}
      </Button>
    </form>
  );
}

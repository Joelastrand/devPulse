"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/TextField";
import { erasureCopy } from "../copy";
import { createErasureClientGateway } from "../client/erasure-gateway";
import { runErasureFlow, type ErasureClientGateway } from "../client/run-erasure-flow";

/**
 * The account erasure confirmation screen (TASK-039, BR-2, BR-3, BR-18). It states the consequences, asks for the typed
 * e-mail and the password, and runs the flow. It has no undo or recovery control (AE-SI-11), and it shows no identifier or
 * raw error text (AE-SI-2). On completion it shows a neutral screen only.
 */

type ViewState =
  | { readonly kind: "form"; readonly error?: keyof typeof erasureCopy.errors }
  | { readonly kind: "progress" }
  | { readonly kind: "completed" };

export interface ErasureConfirmationProps {
  /** Injected in tests; the browser gateway is the default. */
  readonly gateway?: ErasureClientGateway;
}

export function ErasureConfirmation({ gateway }: ErasureConfirmationProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [view, setView] = useState<ViewState>({ kind: "form" });

  // Focus moves to the e-mail field after a failed attempt. It runs after the render that re-enables the field, because a
  // disabled field cannot take focus.
  useEffect(() => {
    if (view.kind === "form" && view.error !== undefined) document.getElementById("erasure-email")?.focus();
  }, [view]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedPassword = password;
    // The password is not kept in state after the attempt, whatever the outcome.
    setPassword("");
    setView({ kind: "progress" });

    let result: Awaited<ReturnType<typeof runErasureFlow>>;
    try {
      result = await runErasureFlow(
        { email, password: submittedPassword, onProgress: () => setView({ kind: "progress" }) },
        gateway ?? createErasureClientGateway(),
      );
    } catch {
      // A transport failure has no detail the person needs. It is reported with the generic copy.
      result = { ok: false, error: "generic" };
    }

    if (result.ok) {
      setView({ kind: "completed" });
      return;
    }
    setView({ kind: "form", error: result.error });
  }

  if (view.kind === "completed") {
    return (
      <section aria-labelledby="erasure-completed-heading" className="space-y-3">
        <h2 id="erasure-completed-heading" className="text-xl font-semibold">
          {erasureCopy.completedTitle}
        </h2>
        <p>{erasureCopy.completedBody}</p>
        <p role="status" className="sr-only">
          {erasureCopy.completedAnnouncement}
        </p>
      </section>
    );
  }

  const pending = view.kind === "progress";

  return (
    <div className="space-y-6">
      <section aria-labelledby="erasure-consequences-heading">
        <h2 id="erasure-consequences-heading" className="text-lg font-semibold">
          {erasureCopy.consequencesTitle}
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          {erasureCopy.consequences.map((consequence) => (
            <li key={consequence}>{consequence}</li>
          ))}
        </ul>
      </section>

      <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-label={erasureCopy.submit}>
        <TextField
          id="erasure-email"
          name="email"
          type="email"
          autoComplete="email"
          label={erasureCopy.emailLabel}
          description={erasureCopy.emailHint}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          disabled={pending}
        />
        <TextField
          id="erasure-password"
          name="password"
          type="password"
          autoComplete="current-password"
          label={erasureCopy.passwordLabel}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          disabled={pending}
        />

        {view.kind === "form" && view.error !== undefined ? (
          <Alert variant="error">{erasureCopy.errors[view.error]}</Alert>
        ) : null}

        {/* The status region stays mounted, so a screen reader announces the text when it changes. */}
        <div role="status" aria-live="polite">
          {pending ? <Alert variant="info">{erasureCopy.progress}</Alert> : null}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" variant="destructive" pending={pending}>
            {pending ? erasureCopy.submitting : erasureCopy.submit}
          </Button>
          <Link href="/me/profile" className="text-sm font-medium text-zinc-700 underline dark:text-zinc-300">
            {erasureCopy.cancel}
          </Link>
        </div>
      </form>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/TextField";
import { signIn } from "../client/auth-client";
import { resolveSignInDestination } from "../domain/continuation";
import { authCopy } from "../copy";
import { VerificationPending } from "./VerificationPending";

type Status = "idle" | "submitting" | "success" | "error" | "unverified";

const ERROR_ALERT_ID = "sign-in-error";

interface SignInFormProps {
  /**
   * The raw `continue` query value from `/sign-in`'s URL, exactly as
   * Next.js's `searchParams` hands it over — untrusted until validated by
   * `resolveSignInDestination` below. Absent for the existing default
   * `/` post-login behavior.
   */
  continuation?: string | string[] | null;
}

export function SignInForm({ continuation }: SignInFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const hasError = status === "error";
  const router = useRouter();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");

    const result = await signIn(email, password);
    if (!result.ok) {
      // An unverified account is not a wrong password: explain the next step instead of a generic error.
      setStatus(result.error === "email_not_verified" ? "unverified" : "error");
      return;
    }
    // D-1: navigate automatically. The success alert below is only a fallback
    // while navigation is in progress; its link targets the same destination.
    setStatus("success");
    router.replace(resolveSignInDestination(continuation).path);
  }

  if (status === "unverified") {
    return <VerificationPending variant="unverified" />;
  }

  if (status === "success") {
    const destination = resolveSignInDestination(continuation);
    const continueLabel = destination.isSurveyContinuation
      ? authCopy.signIn.continueToSurveyLabel
      : authCopy.signIn.continueLabel;

    return (
      <Alert variant="success" className="mt-6">
        {authCopy.signIn.success}{" "}
        <Link
          href={destination.path}
          className="font-medium underline dark:text-zinc-50"
        >
          {continueLabel}
        </Link>
        .
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
      <TextField
        id="sign-in-email"
        label={authCopy.signIn.emailLabel}
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? ERROR_ALERT_ID : undefined}
      />

      <TextField
        id="sign-in-password"
        label={authCopy.signIn.passwordLabel}
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? ERROR_ALERT_ID : undefined}
      />

      <Button type="submit" pending={status === "submitting"}>
        {status === "submitting" ? authCopy.signIn.submitting : authCopy.signIn.submit}
      </Button>

      {hasError && (
        <Alert variant="error" id={ERROR_ALERT_ID} className="text-sm">
          {authCopy.signIn.error}
        </Alert>
      )}
    </form>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/TextField";
import { signUp } from "../client/auth-client";
import { authCopy } from "../copy";

type Status = "idle" | "submitting" | "success" | "error";

const ERROR_ALERT_ID = "sign-up-error";

export function SignUpForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const hasError = status === "error";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");

    const result = await signUp(email, password);
    setStatus(result.ok ? "success" : "error");
  }

  if (status === "success") {
    return (
      <Alert variant="success" className="mt-6">
        {authCopy.signUp.success}
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
      <TextField
        id="sign-up-email"
        label={authCopy.signUp.emailLabel}
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? ERROR_ALERT_ID : undefined}
      />

      <TextField
        id="sign-up-password"
        label={authCopy.signUp.passwordLabel}
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? ERROR_ALERT_ID : undefined}
      />

      <Button type="submit" pending={status === "submitting"}>
        {status === "submitting" ? authCopy.signUp.submitting : authCopy.signUp.submit}
      </Button>

      {hasError && (
        <Alert variant="error" id={ERROR_ALERT_ID} className="text-sm">
          {authCopy.signUp.error}
        </Alert>
      )}
    </form>
  );
}

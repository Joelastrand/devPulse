"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { signUp } from "../client/auth-client";
import { authCopy } from "../copy";

type Status = "idle" | "submitting" | "success" | "error";

export function SignUpForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");

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
      <div className="flex flex-col gap-2">
        <label
          htmlFor="sign-up-email"
          className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
        >
          {authCopy.signUp.emailLabel}
        </label>
        <input
          id="sign-up-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded border border-zinc-300 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="sign-up-password"
          className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
        >
          {authCopy.signUp.passwordLabel}
        </label>
        <input
          id="sign-up-password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded border border-zinc-300 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <Button type="submit" pending={status === "submitting"}>
        {status === "submitting" ? authCopy.signUp.submitting : authCopy.signUp.submit}
      </Button>

      {status === "error" && (
        <Alert variant="error" className="text-sm">
          {authCopy.signUp.error}
        </Alert>
      )}
    </form>
  );
}

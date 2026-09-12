"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { signIn } from "../client/auth-client";
import { authCopy } from "../copy";

type Status = "idle" | "submitting" | "success" | "error";

export function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");

    const result = await signIn(email, password);
    setStatus(result.ok ? "success" : "error");
  }

  if (status === "success") {
    return (
      <Alert variant="success" className="mt-6">
        {authCopy.signIn.success}{" "}
        <Link href="/teams" className="font-medium underline dark:text-zinc-50">
          {authCopy.signIn.continueLabel}
        </Link>
        .
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <label
          htmlFor="sign-in-email"
          className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
        >
          {authCopy.signIn.emailLabel}
        </label>
        <input
          id="sign-in-email"
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
          htmlFor="sign-in-password"
          className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
        >
          {authCopy.signIn.passwordLabel}
        </label>
        <input
          id="sign-in-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded border border-zinc-300 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <Button type="submit" pending={status === "submitting"}>
        {status === "submitting" ? authCopy.signIn.submitting : authCopy.signIn.submit}
      </Button>

      {status === "error" && (
        <Alert variant="error" className="text-sm">
          {authCopy.signIn.error}
        </Alert>
      )}
    </form>
  );
}

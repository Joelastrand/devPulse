"use client";

import { useState, type FormEvent } from "react";
import { signUp } from "../client/auth-client";

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
      <p role="status" className="mt-6 text-zinc-900 dark:text-zinc-50">
        Account created. Check your email for a verification link — you must
        verify your email before your team&apos;s dashboard becomes
        available.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <label
          htmlFor="sign-up-email"
          className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
        >
          Email
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
          Password
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

      <button
        type="submit"
        disabled={status === "submitting"}
        className="rounded-full bg-foreground px-5 py-2.5 text-background transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "submitting" ? "Creating account…" : "Sign up"}
      </button>

      {status === "error" && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          Something went wrong. Please try again.
        </p>
      )}
    </form>
  );
}

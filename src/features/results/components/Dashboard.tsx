"use client";

import { useEffect, useState } from "react";
import { observeIdToken } from "../../auth/client/auth-client";
import { fetchDashboard, type DashboardFetchResult } from "../client/dashboard-gateway";
import { PeriodSummary } from "./PeriodSummary";
import { TrendTable } from "./TrendTable";

function assertNever(value: never): never {
  throw new Error(`Unhandled dashboard result: ${JSON.stringify(value)}`);
}

/**
 * Renders exactly one view per `DashboardFetchResult` status. Extracted
 * from `Dashboard` so the exhaustiveness guard below is directly testable:
 * if `DashboardFetchResult` ever gains a variant without a matching `case`
 * here, `result` in the `default` branch stops being assignable to
 * `never` and `pnpm typecheck` fails — this can't silently render nothing.
 */
export function renderDashboardResult(result: DashboardFetchResult) {
  switch (result.status) {
    case "unauthenticated":
      return <SignInPrompt />;
    case "no_team":
      return (
        <p role="status" className="text-zinc-600 dark:text-zinc-400">
          No team is available for your account yet. Make sure your email is
          verified and assigned to a team.
        </p>
      );
    case "read_failed":
      return (
        <p role="alert" className="text-red-700 dark:text-red-400">
          Something went wrong loading your results. Please try again later.
        </p>
      );
    case "ok":
      return (
        <div className="flex flex-col gap-8">
          <PeriodSummary result={result.current} />
          <TrendTable results={result.trend} />
        </div>
      );
    default:
      return assertNever(result);
  }
}

type ViewState =
  | { phase: "loading" }
  | { phase: "signed_out" }
  | { phase: "loaded"; result: DashboardFetchResult };

/**
 * Protected team dashboard. The client holds the Firebase-managed ID token
 * (no server session) and sends it to `GET /api/results` on each auth-state
 * change; this component only ever renders the already-computed aggregate
 * figures `getDashboard` returns — it performs no decryption, aggregation,
 * or team-resolution logic itself (`.claude/rules/security.md`).
 */
export function Dashboard() {
  const [state, setState] = useState<ViewState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = observeIdToken((token) => {
      if (!token) {
        if (!cancelled) {
          setState({ phase: "signed_out" });
        }
        return;
      }

      fetchDashboard(token).then((result) => {
        if (!cancelled) {
          setState({ phase: "loaded", result });
        }
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  if (state.phase === "loading") {
    return (
      <p role="status" className="text-zinc-600 dark:text-zinc-400">
        Loading your results…
      </p>
    );
  }

  if (state.phase === "signed_out") {
    return <SignInPrompt />;
  }

  return renderDashboardResult(state.result);
}

function SignInPrompt() {
  return (
    <p className="text-zinc-600 dark:text-zinc-400">
      <a href="/sign-in" className="font-medium text-zinc-900 underline dark:text-zinc-50">
        Sign in
      </a>{" "}
      to see your team&apos;s results.
    </p>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { observeIdToken } from "../../auth/client/auth-client";
import { fetchTeamResults } from "../../results/client/team-results-gateway";
import type { PeriodAggregateResult } from "../../results/domain/aggregation";
import { PeriodSummary } from "../../results/components/PeriodSummary";
import { TrendTable } from "../../results/components/TrendTable";
import {
  fetchTeamsOverview,
  requestTeamAccess,
} from "../client/teams-overview-gateway";
import { requestAccessErrorMessage } from "./request-access-messages";

type DeniedRelationship = "none" | "request_pending" | "request_rejected";

/**
 * The composed result this component renders — never a raw gateway
 * response. Only `authorized` ever carries result/aggregate data; every
 * other state is a non-sensitive "you don't have access" variant
 * (docs/features/team-management/SPEC.md — BR-14, BR-15, BR-16).
 */
type TeamDetailResult =
  | { status: "unauthenticated" }
  | { status: "read_failed" }
  | { status: "denied"; name?: string; relationship: DeniedRelationship }
  | { status: "results_unavailable"; name?: string }
  | {
      status: "authorized";
      name?: string;
      current: PeriodAggregateResult;
      trend: PeriodAggregateResult[];
    };

/**
 * Loads one team's detail: the caller's relationship to `teamId` (via the
 * existing TASK-007 `/teams` overview, reused unchanged — no new metadata
 * endpoint is introduced) and, unless the overview already reports a known
 * negative relationship, that team's results (via the existing TASK-003
 * endpoint, reused unchanged).
 *
 * The overview relationship is used only to *skip* an unnecessary results
 * request for a caller the trusted backend already reports as
 * non-member/pending/rejected (BR-15's "never queried for a *denied*
 * caller", applied only to a *known* denial) — it is never itself treated
 * as the authorization decision. `"admin"`/`"member"` fetch results as
 * before. An **absent** overview entry is ambiguous, not a known denial: it
 * can mean a nonexistent team, a disabled team the caller has no
 * relationship to, *or* a disabled team an app admin holds no
 * `teamMemberships` document for — `getTeamsOverview` deliberately does not
 * enumerate every disabled team for an app admin (that full catalog is
 * TASK-009's job), so its absence alone must never be read as "denied" for
 * an actor `authorizeTeamAccess` would otherwise correctly authorize
 * (review-change TASK-008 finding, BR-3/BR-14). For that ambiguous case the
 * results endpoint — the only authoritative, `authorizeTeamAccess`-backed
 * decision — is always asked before anything is rendered as denied.
 */
async function loadTeamDetail(idToken: string, teamId: string): Promise<TeamDetailResult> {
  const overview = await fetchTeamsOverview(idToken);
  if (overview.status === "unauthenticated") {
    return { status: "unauthenticated" };
  }
  if (overview.status !== "ok") {
    return { status: "read_failed" };
  }

  const entry = overview.teams.find((team) => team.teamId === teamId);

  if (
    entry &&
    (entry.relationship === "none" ||
      entry.relationship === "request_pending" ||
      entry.relationship === "request_rejected")
  ) {
    return { status: "denied", name: entry.name, relationship: entry.relationship };
  }

  // Either a known "admin"/"member" relationship, or no overview entry at
  // all (the ambiguous case) — both resolve via the authoritative results
  // endpoint, never via the overview alone.
  return resolveViaResults(idToken, teamId, entry?.name);
}

async function resolveViaResults(
  idToken: string,
  teamId: string,
  name: string | undefined,
): Promise<TeamDetailResult> {
  const results = await fetchTeamResults(idToken, teamId);
  if (results.status === "ok") {
    return { status: "authorized", name, current: results.current, trend: results.trend };
  }
  if (results.status === "unauthenticated") {
    return { status: "unauthenticated" };
  }
  if (results.status === "forbidden") {
    // Covers both: a known member/admin whose membership was revoked
    // between the overview read and this read (SPEC edge case: "removing a
    // member's teamMemberships document ... their next request is denied"
    // — fail closed rather than trusting the now-stale overview
    // relationship), and the ambiguous no-entry case turning out to be a
    // genuine denial. Rendered identically either way (BR-16) — no
    // distinguishing existence signal.
    return { status: "denied", name, relationship: "none" };
  }
  return { status: "results_unavailable", name };
}

type ViewState =
  | { phase: "loading" }
  | { phase: "signed_out" }
  | { phase: "loaded"; token: string; generation: number; result: TeamDetailResult };

type RequestActionState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "error"; message: string };

const RELATIONSHIP_MESSAGES: Record<DeniedRelationship, string> = {
  none: "You don't have access to this team's results yet.",
  request_pending: "Your request to join this team is pending approval.",
  request_rejected: "Your previous request to join this team was not approved.",
};

/**
 * Authenticated `/teams/[teamId]` detail page
 * (docs/features/team-management/SPEC.md — BR-12, BR-14 through BR-16).
 * Mirrors `TeamsOverview`'s client-side auth-state and generation-guard
 * pattern exactly, extended to also guard against a *route* change: `teamId`
 * is in the effect's dependency array, so navigating from one team to
 * another tears down the previous subscription (bumping the generation,
 * exactly like an auth change) before starting a fresh load for the new
 * team — a slow response for team A can never render on team B's page, and
 * Next.js route-instance reuse is not relied on for this guarantee.
 */
export function TeamDetail({ teamId }: { teamId: string }) {
  const [state, setState] = useState<ViewState>({ phase: "loading" });
  const [actionState, setActionState] = useState<RequestActionState>({ status: "idle" });
  const generationRef = useRef(0);

  const isCurrentGeneration = useCallback((generation: number): boolean => {
    return generationRef.current === generation;
  }, []);

  const loadForGeneration = useCallback(
    async (token: string, generation: number) => {
      const result = await loadTeamDetail(token, teamId);
      if (isCurrentGeneration(generation)) {
        setState({ phase: "loaded", token, generation, result });
      }
    },
    [isCurrentGeneration, teamId],
  );

  useEffect(() => {
    const unsubscribe = observeIdToken((token) => {
      generationRef.current += 1;
      const generation = generationRef.current;
      setActionState({ status: "idle" });

      if (!token) {
        setState({ phase: "signed_out" });
        return;
      }

      setState({ phase: "loading" });
      loadForGeneration(token, generation);
    });

    return () => {
      // Invalidates any in-flight request for this auth state/teamId pair —
      // fires on unmount and, because `teamId` is a dependency below, on
      // every route change between teams too.
      generationRef.current += 1;
      unsubscribe();
    };
  }, [teamId, loadForGeneration]);

  async function handleRequestAccess(token: string, generation: number) {
    setActionState({ status: "pending" });

    const result = await requestTeamAccess(token, teamId);

    if (!isCurrentGeneration(generation)) {
      return;
    }

    if (!result.ok) {
      setActionState({ status: "error", message: requestAccessErrorMessage(result.error) });
      return;
    }

    setActionState({ status: "idle" });
    await loadForGeneration(token, generation);
  }

  if (state.phase === "loading") {
    return (
      <p role="status" className="text-zinc-600 dark:text-zinc-400">
        Loading team…
      </p>
    );
  }

  if (state.phase === "signed_out") {
    return <SignInPrompt />;
  }

  const { result, token, generation } = state;

  if (result.status === "unauthenticated") {
    return <SignInPrompt />;
  }

  if (result.status === "read_failed") {
    return (
      <p role="alert" className="text-red-700 dark:text-red-400">
        Something went wrong loading this team. Please try again later.
      </p>
    );
  }

  if (result.status === "results_unavailable") {
    return (
      <div className="flex flex-col gap-4">
        <TeamHeading name={result.name} />
        <p role="alert" className="text-red-700 dark:text-red-400">
          Something went wrong loading this team&apos;s results. Please try again later.
        </p>
      </div>
    );
  }

  if (result.status === "authorized") {
    return (
      <div className="flex flex-col gap-8">
        <TeamHeading name={result.name} />
        <PeriodSummary result={result.current} />
        <TrendTable results={result.trend} />
      </div>
    );
  }

  const canRequestAccess = result.relationship === "none" || result.relationship === "request_rejected";

  return (
    <div className="flex flex-col gap-4">
      <TeamHeading name={result.name} />
      <p role="status" className="text-zinc-600 dark:text-zinc-400">
        {RELATIONSHIP_MESSAGES[result.relationship]}
      </p>
      {actionState.status === "error" && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {actionState.message}
        </p>
      )}
      {canRequestAccess && (
        <button
          type="button"
          onClick={() => handleRequestAccess(token, generation)}
          disabled={actionState.status === "pending"}
          className="w-fit rounded-full border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
        >
          {actionState.status === "pending" ? "Requesting…" : "Request access"}
        </button>
      )}
    </div>
  );
}

function TeamHeading({ name }: { name?: string }) {
  return (
    <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
      {name ?? "Team"}
    </h1>
  );
}

function SignInPrompt() {
  return (
    <p className="text-zinc-600 dark:text-zinc-400">
      <a href="/sign-in" className="font-medium text-zinc-900 underline dark:text-zinc-50">
        Sign in
      </a>{" "}
      to see this team.
    </p>
  );
}

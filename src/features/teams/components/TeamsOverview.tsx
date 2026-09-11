"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { observeIdToken } from "../../auth/client/auth-client";
import {
  fetchTeamsOverview,
  requestTeamAccess,
  type TeamOverviewEntry,
  type TeamsOverviewFetchResult,
} from "../client/teams-overview-gateway";
import { requestAccessErrorMessage } from "./request-access-messages";

type ViewState =
  | { phase: "loading" }
  | { phase: "signed_out" }
  | { phase: "loaded"; token: string; generation: number; result: TeamsOverviewFetchResult };

type RequestActionState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "error"; message: string };

const RELATIONSHIP_LABELS: Record<TeamOverviewEntry["relationship"], string> = {
  admin: "Admin",
  member: "Member",
  request_pending: "Request pending",
  request_rejected: "Request rejected",
  none: "Not a member",
};

/**
 * Authenticated `/teams` overview (docs/features/team-management/SPEC.md —
 * BR-11 through BR-13, BR-23). Uses this feature's established client-side
 * auth-state pattern: the client holds the Firebase ID token (no server
 * session) and sends it to `GET /api/teams` on each auth-state change. This
 * component renders only the already-computed relationship
 * `getTeamsOverview` returns — no team's protected results data is ever
 * fetched or rendered here.
 *
 * Every auth-state change (sign-out, account switch, or a token refresh)
 * bumps `generationRef`, a monotonic counter — not the caller's uid or
 * email — used purely to correlate an in-flight request with the auth
 * state that started it. Any async result (the initial overview fetch, or
 * a post-request-access refresh) is applied only if `generationRef` still
 * matches the generation it was started under; otherwise it's silently
 * discarded. This is the single guard for every state-changing async path
 * in this component — including on unmount, since the cleanup function
 * also bumps the generation — so a slow response from a superseded auth
 * state (or an unmounted component) can never overwrite what's currently
 * shown. No authorization decision is made client-side; the server remains
 * the sole source of truth for every value actually rendered.
 */
export function TeamsOverview() {
  const [state, setState] = useState<ViewState>({ phase: "loading" });
  const [actionStates, setActionStates] = useState<Record<string, RequestActionState>>({});
  const generationRef = useRef(0);

  const isCurrentGeneration = useCallback((generation: number): boolean => {
    return generationRef.current === generation;
  }, []);

  /**
   * The one shared guarded-fetch mechanism every async overview load goes
   * through (initial load and the post-request-access refresh alike): the
   * result is applied only if no newer auth state (or unmount) has
   * superseded `generation` since this call started. Stable identity (only
   * refs/setState/module-level imports as dependencies) so it can be
   * listed in the mount effect's dependency array without re-subscribing.
   */
  const loadOverviewForGeneration = useCallback(
    async (token: string, generation: number) => {
      const result = await fetchTeamsOverview(token);
      if (isCurrentGeneration(generation)) {
        setState({ phase: "loaded", token, generation, result });
      }
    },
    [isCurrentGeneration],
  );

  useEffect(() => {
    const unsubscribe = observeIdToken((token) => {
      generationRef.current += 1;
      const generation = generationRef.current;
      // A new auth state starts clean: no stale per-team action indicator
      // (pending/error) from a previous identity can carry over.
      setActionStates({});

      if (!token) {
        setState({ phase: "signed_out" });
        return;
      }

      // Never keep the previous identity's team list on screen while the
      // new one loads — sign-out, an account switch, and a token refresh
      // are all indistinguishable at this callback, so all of them clear
      // first.
      setState({ phase: "loading" });
      loadOverviewForGeneration(token, generation);
    });

    return () => {
      // Invalidates any request still in flight for this component
      // instance, exactly like an auth change would.
      generationRef.current += 1;
      unsubscribe();
    };
  }, [loadOverviewForGeneration]);

  async function handleRequestAccess(token: string, teamId: string, generation: number) {
    setActionStates((prev) => ({ ...prev, [teamId]: { status: "pending" } }));

    const result = await requestTeamAccess(token, teamId);

    if (!isCurrentGeneration(generation)) {
      // Auth has since changed (or the component unmounted); this result
      // belongs to a superseded identity and must not touch current state.
      return;
    }

    if (!result.ok) {
      setActionStates((prev) => ({
        ...prev,
        [teamId]: { status: "error", message: requestAccessErrorMessage(result.error) },
      }));
      return;
    }

    setActionStates((prev) => ({ ...prev, [teamId]: { status: "idle" } }));
    // Re-fetch the authoritative overview rather than guessing the new
    // relationship client-side — `already_authorized` in particular could
    // mean either `member` or `admin`, which only the server knows.
    await loadOverviewForGeneration(token, generation);
  }

  if (state.phase === "loading") {
    return (
      <p role="status" className="text-zinc-600 dark:text-zinc-400">
        Loading teams…
      </p>
    );
  }

  if (state.phase === "signed_out") {
    return <SignInPrompt />;
  }

  const { result, token, generation } = state;

  if (result.status !== "ok") {
    if (result.status === "unauthenticated") {
      return <SignInPrompt />;
    }
    return (
      <p role="alert" className="text-red-700 dark:text-red-400">
        Something went wrong loading teams. Please try again later.
      </p>
    );
  }

  const { teams } = result;

  if (teams.length === 0) {
    return (
      <p role="status" className="text-zinc-600 dark:text-zinc-400">
        No teams are available yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {teams.map((team) => {
        const action = actionStates[team.teamId] ?? { status: "idle" as const };
        const canRequestAccess =
          team.relationship === "none" || team.relationship === "request_rejected";
        const canOpen = team.relationship === "admin" || team.relationship === "member";

        return (
          <li
            key={team.teamId}
            className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
          >
            <div>
              {canOpen ? (
                <Link
                  href={`/teams/${encodeURIComponent(team.teamId)}`}
                  className="font-medium text-zinc-900 underline dark:text-zinc-50"
                >
                  {team.name}
                </Link>
              ) : (
                <p className="font-medium text-zinc-900 dark:text-zinc-50">{team.name}</p>
              )}
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {RELATIONSHIP_LABELS[team.relationship]}
              </p>
              {action.status === "error" && (
                <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
                  {action.message}
                </p>
              )}
            </div>
            {canRequestAccess && (
              <button
                type="button"
                onClick={() => handleRequestAccess(token, team.teamId, generation)}
                disabled={action.status === "pending"}
                className="shrink-0 rounded-full border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
              >
                {action.status === "pending" ? "Requesting…" : "Request access"}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SignInPrompt() {
  return (
    <p className="text-zinc-600 dark:text-zinc-400">
      <a href="/sign-in" className="font-medium text-zinc-900 underline dark:text-zinc-50">
        Sign in
      </a>{" "}
      to see the teams overview.
    </p>
  );
}

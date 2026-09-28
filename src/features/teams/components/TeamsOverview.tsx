"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { teamsCopy } from "../copy";
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

const RELATIONSHIP_LABELS: Record<TeamOverviewEntry["relationship"], string> =
  teamsCopy.relationshipLabels;

/**
 * Authenticated `/teams` overview (docs/features/team-management/SPEC.md —
 * BR-11 through BR-13, BR-23). Uses this feature's established client-side
 * auth-state pattern: the client holds the Firebase ID token (no server
 * session) and sends it to `GET /api/teams` on each auth-state change. This
 * component renders only the already-computed relationship
 * `getTeamsOverview` returns — no team's protected results data is ever
 * fetched or rendered here.
 *
 * Every auth-state change (sign-out, account switch, or a token refresh) —
 * and unmount — invalidates any in-flight request via the shared
 * `useAuthGatedResource` generation guard, so a slow response from a
 * superseded auth state (or an unmounted component) can never overwrite
 * what's currently shown. No authorization decision is made client-side;
 * the server remains the sole source of truth for every value actually
 * rendered.
 */
export function TeamsOverview() {
  const [state, setState] = useState<ViewState>({ phase: "loading" });
  const [actionStates, setActionStates] = useState<Record<string, RequestActionState>>({});

  const { isCurrentGeneration } = useAuthGatedResource((token, generation) => {
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

  /**
   * The one shared guarded-fetch mechanism every async overview load goes
   * through (initial load and the post-request-access refresh alike): the
   * result is applied only if no newer auth state (or unmount) has
   * superseded `generation` since this call started. A hoisted function
   * declaration (not `useCallback`) so it can be referenced above, in the
   * auth-change callback, without an evaluation-order issue — it no longer
   * needs to be memoized for an effect's dependency array now that the
   * subscription lives inside `useAuthGatedResource`.
   */
  async function loadOverviewForGeneration(token: string, generation: number) {
    const result = await fetchTeamsOverview(token);
    if (isCurrentGeneration(generation)) {
      setState({ phase: "loaded", token, generation, result });
    }
  }

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
    return <LoadingState label={teamsCopy.overview.loading} />;
  }

  if (state.phase === "signed_out") {
    return <SignInPrompt />;
  }

  const { result, token, generation } = state;

  if (result.status !== "ok") {
    if (result.status === "unauthenticated") {
      return <SignInPrompt />;
    }
    return <Alert variant="error">{teamsCopy.overview.error}</Alert>;
  }

  const { teams } = result;

  if (teams.length === 0) {
    return <EmptyState>{teamsCopy.overview.empty}</EmptyState>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {teams.map((team) => {
        const action = actionStates[team.teamId] ?? { status: "idle" as const };
        const canRequestAccess =
          team.relationship === "none" || team.relationship === "request_rejected";
        const canOpen = team.relationship === "admin" || team.relationship === "member";

        return (
          <Card
            as="li"
            key={team.teamId}
            variant="bordered"
            padding="sm"
            className="flex items-center justify-between gap-4"
          >
            <div className="min-w-0">
              {canOpen ? (
                <Link
                  href={`/teams/${encodeURIComponent(team.teamId)}`}
                  className="break-words font-medium text-zinc-900 underline dark:text-zinc-50"
                >
                  {team.name}
                </Link>
              ) : (
                <p className="break-words font-medium text-zinc-900 dark:text-zinc-50">{team.name}</p>
              )}
              <p className="mt-1">
                <Badge>{RELATIONSHIP_LABELS[team.relationship]}</Badge>
              </p>
              {action.status === "error" && (
                <Alert variant="error" className="mt-1 text-sm">
                  {action.message}
                </Alert>
              )}
            </div>
            {canRequestAccess && (
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                pending={action.status === "pending"}
                onClick={() => handleRequestAccess(token, team.teamId, generation)}
              >
                {action.status === "pending" ? teamsCopy.requestingAccess : teamsCopy.requestAccess}
              </Button>
            )}
          </Card>
        );
      })}
    </ul>
  );
}

function SignInPrompt() {
  return (
    <p className="text-zinc-600 dark:text-zinc-400">
      <Link href="/sign-in" className="font-medium text-zinc-900 underline dark:text-zinc-50">
        {teamsCopy.overview.signInLink}
      </Link>{" "}
      {teamsCopy.overview.signInPrompt}
    </p>
  );
}

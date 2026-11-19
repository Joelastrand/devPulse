"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { EmptyState } from "../../../components/ui/EmptyState";
import { TeamsGridSkeleton } from "./TeamAdminSkeletons";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { teamsCopy } from "../copy";
import {
  fetchTeamsOverview,
  requestTeamAccess,
  type TeamOverviewEntry,
  type TeamsOverviewFetchResult,
} from "../client/teams-overview-gateway";
import { requestAccessErrorMessage } from "./request-access-messages";
import { TeamCard, type TeamCardRequestState } from "./TeamCard";
import { TeamsPageContent } from "./TeamsPageContent";

type ViewState =
  | { phase: "loading" }
  | { phase: "signed_out" }
  | { phase: "loaded"; token: string; generation: number; result: TeamsOverviewFetchResult };

type RequestActionState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "error"; message: string };

function toCardRequestState(action: RequestActionState): TeamCardRequestState {
  return {
    pending: action.status === "pending",
    errorMessage: action.status === "error" ? action.message : undefined,
  };
}

const PARENT_SUPPLIED_RESULT: TeamsOverviewFetchResult = { status: "ok", teams: [] };

/**
 * Authenticated `/teams` overview (docs/archive/features/team-management/SPEC.md —
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
 *
 * When `initialTeams` is supplied (the signed-in home already holds the teams
 * list), the list is rendered as given and this component makes no read.
 * Without it, the component fetches the overview itself, as above.
 *
 * When `initialTeams` is supplied, `onTeamsChanged` (optional) is called once
 * after a successful request-access so the parent can re-run its own teams
 * read and pass a fresh `initialTeams`. Without `initialTeams` it has no effect.
 */
export function TeamsOverview({
  initialTeams,
  onTeamsChanged,
  layout = "list",
}: {
  initialTeams?: TeamOverviewEntry[];
  onTeamsChanged?: () => void;
  /** `list` is the compact card grid used on the home page; `page` is the full Team page (summary, search, groups). */
  layout?: "list" | "page";
} = {}) {
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

    if (initialTeams !== undefined) {
      // The parent already holds the teams list, so this component makes no
      // read. The placeholder result is never rendered: `initialTeams` is.
      setState({ phase: "loaded", token, generation, result: PARENT_SUPPLIED_RESULT });
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
    // mean either `member` or `admin`, which only the server knows. When the
    // parent supplied the list, this component makes no read and instead
    // asks the parent to refresh its own list.
    if (initialTeams === undefined) {
      await loadOverviewForGeneration(token, generation);
    } else {
      onTeamsChanged?.();
    }
  }

  if (state.phase === "loading") {
    return <TeamsGridSkeleton label={teamsCopy.overview.loading} />;
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

  const teams = initialTeams ?? result.teams;

  if (teams.length === 0) {
    return <EmptyState>{teamsCopy.overview.empty}</EmptyState>;
  }

  const requestStates: Record<string, TeamCardRequestState> = Object.fromEntries(
    Object.entries(actionStates).map(([teamId, action]) => [teamId, toCardRequestState(action)]),
  );

  if (layout === "page") {
    return (
      <TeamsPageContent
        teams={teams}
        requestStates={requestStates}
        onRequestAccess={(teamId) => handleRequestAccess(token, teamId, generation)}
      />
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {teams.map((team) => (
        <TeamCard
          key={team.teamId}
          team={team}
          requestState={requestStates[team.teamId]}
          onRequestAccess={() => handleRequestAccess(token, team.teamId, generation)}
        />
      ))}
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

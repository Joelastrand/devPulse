"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { observeIdToken } from "../../auth/client/auth-client";
import {
  createAdminTeam,
  fetchAdminTeams,
  setAdminTeamStatus,
  type AdminTeamsFetchResult,
} from "../client/admin-teams-gateway";
import type { TeamStatus } from "../domain/team";

type ViewState =
  | { phase: "loading" }
  | { phase: "signed_out" }
  | { phase: "loaded"; token: string; generation: number; result: AdminTeamsFetchResult };

type CreateState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "error"; message: string };

type StatusActionState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "error"; message: string };

function createErrorMessage(error: string): string {
  if (error === "invalid_name") {
    return "Enter a team name.";
  }
  return "Something went wrong creating the team. Please try again.";
}

/**
 * Admin-only `/admin/teams` page (docs/features/team-management/SPEC.md —
 * BR-1, BR-2, BR-3 UI). Mirrors `TeamsOverview`/`TeamDetail`'s client-side
 * auth-state and generation-guard pattern exactly: the client holds the
 * Firebase ID token (no server session) and every admin operation
 * (`listTeams`, `createTeam`, `setTeamStatus`) is re-authorized server-side
 * on every call via the existing, unchanged TASK-001 `requireAppAdmin`
 * boundary — this component never decides admin status itself, and
 * `APP_ADMIN_EMAILS` never reaches the client in any form.
 *
 * `generationRef` bumps on every auth-state change (sign-out, account
 * switch, token refresh) and on unmount; the initial list load, the
 * post-create refresh, and the post-status-change refresh are all applied
 * only if `generationRef` still matches the generation the async call
 * started under — a slow response for a superseded identity can never
 * overwrite what's currently shown, and a caller whose auth changes
 * mid-operation fails closed (the stale result is simply discarded, not
 * rendered as if it belonged to the new identity).
 */
export function AdminTeams() {
  const [state, setState] = useState<ViewState>({ phase: "loading" });
  const [createState, setCreateState] = useState<CreateState>({ status: "idle" });
  const [name, setName] = useState("");
  const [statusActions, setStatusActions] = useState<Record<string, StatusActionState>>({});
  const generationRef = useRef(0);

  const isCurrentGeneration = useCallback((generation: number): boolean => {
    return generationRef.current === generation;
  }, []);

  /**
   * The one shared guarded-fetch mechanism every async list load goes
   * through (initial load, post-create refresh, post-status-change
   * refresh alike) — mirrors `TeamsOverview`'s `loadOverviewForGeneration`.
   */
  const loadForGeneration = useCallback(
    async (token: string, generation: number) => {
      const result = await fetchAdminTeams(token);
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
      // A new auth state starts clean: no stale create/status-action
      // indicator from a previous identity can carry over.
      setCreateState({ status: "idle" });
      setStatusActions({});
      setName("");

      if (!token) {
        setState({ phase: "signed_out" });
        return;
      }

      setState({ phase: "loading" });
      loadForGeneration(token, generation);
    });

    return () => {
      // Invalidates any request still in flight for this component
      // instance, exactly like an auth change would.
      generationRef.current += 1;
      unsubscribe();
    };
  }, [loadForGeneration]);

  async function handleCreate(
    event: FormEvent<HTMLFormElement>,
    token: string,
    generation: number,
  ) {
    event.preventDefault();
    if (createState.status === "pending") {
      // Defense in depth alongside the submit button's own `disabled`
      // state — a rapid repeated submit while a create is already in
      // flight must never fire a second request.
      return;
    }

    setCreateState({ status: "pending" });
    const result = await createAdminTeam(token, name);

    if (!isCurrentGeneration(generation)) {
      return;
    }

    if (!result.ok) {
      setCreateState({ status: "error", message: createErrorMessage(result.error) });
      return;
    }

    setCreateState({ status: "idle" });
    setName("");
    // Re-fetch the authoritative list rather than fabricating the new team
    // client-side — the server is the only source of truth for its final
    // shape (and for whether it actually persisted).
    await loadForGeneration(token, generation);
  }

  async function handleSetStatus(
    token: string,
    generation: number,
    teamId: string,
    status: TeamStatus,
  ) {
    if (statusActions[teamId]?.status === "pending") {
      // Defense in depth alongside the button's own `disabled` state — a
      // rapid repeated click on this team's action while one is already in
      // flight must never fire a second request. Keyed per-team, so a
      // different team's independent action is never blocked by this.
      return;
    }

    setStatusActions((prev) => ({ ...prev, [teamId]: { status: "pending" } }));

    const result = await setAdminTeamStatus(token, teamId, status);

    if (!isCurrentGeneration(generation)) {
      // Auth has since changed (or the component unmounted); this result
      // belongs to a superseded identity and must not touch current state.
      return;
    }

    if (!result.ok) {
      setStatusActions((prev) => ({
        ...prev,
        [teamId]: {
          status: "error",
          message: "Something went wrong updating this team. Please try again.",
        },
      }));
      return;
    }

    setStatusActions((prev) => ({ ...prev, [teamId]: { status: "idle" } }));
    // Re-fetch rather than optimistically flipping the row's status client-
    // side — the server remains the sole source of truth for whether the
    // mutation actually took effect.
    await loadForGeneration(token, generation);
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

  if (result.status === "unauthenticated") {
    return <SignInPrompt />;
  }

  if (result.status === "forbidden") {
    // Deliberately generic — never confirms or denies whether the caller's
    // email is on the server-only `APP_ADMIN_EMAILS` allow-list.
    return (
      <p role="alert" className="text-red-700 dark:text-red-400">
        You don&apos;t have permission to view this page.
      </p>
    );
  }

  if (result.status === "read_failed") {
    return (
      <p role="alert" className="text-red-700 dark:text-red-400">
        Something went wrong loading teams. Please try again later.
      </p>
    );
  }

  const { teams } = result;

  return (
    <div className="flex flex-col gap-8">
      <form
        onSubmit={(event) => handleCreate(event, token, generation)}
        className="flex flex-col gap-2"
      >
        <label
          htmlFor="admin-new-team-name"
          className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
        >
          New team name
        </label>
        <div className="flex gap-2">
          <input
            id="admin-new-team-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="flex-1 rounded border border-zinc-300 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            disabled={createState.status === "pending"}
            className="shrink-0 rounded-full bg-foreground px-5 py-2 text-background transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createState.status === "pending" ? "Creating…" : "Create team"}
          </button>
        </div>
        {createState.status === "error" && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {createState.message}
          </p>
        )}
      </form>

      {teams.length === 0 ? (
        <p role="status" className="text-zinc-600 dark:text-zinc-400">
          No teams yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {teams.map((team) => {
            const action = statusActions[team.teamId] ?? { status: "idle" as const };
            const nextStatus: TeamStatus = team.status === "active" ? "disabled" : "active";
            const isDisabling = team.status === "active";

            return (
              <li
                key={team.teamId}
                className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
              >
                <div>
                  <a
                    href={`/admin/teams/${encodeURIComponent(team.teamId)}`}
                    className="font-medium text-zinc-900 underline dark:text-zinc-50"
                  >
                    {team.name}
                  </a>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {team.status === "active" ? "Active" : "Disabled"} · {team.teamId}
                  </p>
                  {action.status === "error" && (
                    <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
                      {action.message}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleSetStatus(token, generation, team.teamId, nextStatus)}
                  disabled={action.status === "pending"}
                  className={
                    isDisabling
                      ? "shrink-0 rounded-full border border-red-300 px-4 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                      : "shrink-0 rounded-full border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
                  }
                >
                  {action.status === "pending"
                    ? "Updating…"
                    : isDisabling
                      ? "Disable team"
                      : "Enable team"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SignInPrompt() {
  return (
    <p className="text-zinc-600 dark:text-zinc-400">
      <a href="/sign-in" className="font-medium text-zinc-900 underline dark:text-zinc-50">
        Sign in
      </a>{" "}
      to manage teams.
    </p>
  );
}

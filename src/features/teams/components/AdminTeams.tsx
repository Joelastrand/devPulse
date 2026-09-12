"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { adminCopy } from "../copy";
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
    return adminCopy.teams.createError.invalidName;
  }
  return adminCopy.teams.createError.generic;
}

/**
 * Admin-only `/admin/teams` page (docs/features/team-management/SPEC.md —
 * BR-1, BR-2, BR-3 UI). Mirrors `TeamsOverview`/`TeamDetail`'s client-side
 * auth-state and generation-guard pattern via the shared
 * `useAuthGatedResource` hook: the client holds the Firebase ID token (no
 * server session) and every admin operation (`listTeams`, `createTeam`,
 * `setTeamStatus`) is re-authorized server-side on every call via the
 * existing, unchanged TASK-001 `requireAppAdmin` boundary — this component
 * never decides admin status itself, and `APP_ADMIN_EMAILS` never reaches
 * the client in any form.
 *
 * The shared hook's generation guard invalidates the initial list load, the
 * post-create refresh, and the post-status-change refresh alike on every
 * auth-state change (sign-out, account switch, token refresh) and on
 * unmount — a slow response for a superseded identity can never overwrite
 * what's currently shown, and a caller whose auth changes mid-operation
 * fails closed (the stale result is simply discarded, not rendered as if
 * it belonged to the new identity).
 */
export function AdminTeams() {
  const [state, setState] = useState<ViewState>({ phase: "loading" });
  const [createState, setCreateState] = useState<CreateState>({ status: "idle" });
  const [name, setName] = useState("");
  const [statusActions, setStatusActions] = useState<Record<string, StatusActionState>>({});

  const { isCurrentGeneration } = useAuthGatedResource((token, generation) => {
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

  /**
   * The one shared guarded-fetch mechanism every async list load goes
   * through (initial load, post-create refresh, post-status-change
   * refresh alike) — mirrors `TeamsOverview`'s `loadOverviewForGeneration`.
   * A hoisted function declaration (not `useCallback`) so it can be
   * referenced above, in the auth-change callback, without an
   * evaluation-order issue.
   */
  async function loadForGeneration(token: string, generation: number) {
    const result = await fetchAdminTeams(token);
    if (isCurrentGeneration(generation)) {
      setState({ phase: "loaded", token, generation, result });
    }
  }

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
          message: adminCopy.teams.statusUpdateError,
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
    return <LoadingState label={adminCopy.teams.loading} />;
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
    return <Alert variant="error">{adminCopy.teams.forbidden}</Alert>;
  }

  if (result.status === "read_failed") {
    return <Alert variant="error">{adminCopy.teams.error}</Alert>;
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
          {adminCopy.teams.newTeamNameLabel}
        </label>
        <div className="flex gap-2">
          <input
            id="admin-new-team-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="flex-1 rounded border border-zinc-300 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <Button type="submit" className="shrink-0" pending={createState.status === "pending"}>
            {createState.status === "pending" ? adminCopy.teams.creatingButton : adminCopy.teams.createButton}
          </Button>
        </div>
        {createState.status === "error" && (
          <Alert variant="error" className="text-sm">
            {createState.message}
          </Alert>
        )}
      </form>

      {teams.length === 0 ? (
        <EmptyState>{adminCopy.teams.empty}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {teams.map((team) => {
            const action = statusActions[team.teamId] ?? { status: "idle" as const };
            const nextStatus: TeamStatus = team.status === "active" ? "disabled" : "active";
            const isDisabling = team.status === "active";

            return (
              <Card
                as="li"
                key={team.teamId}
                variant="bordered"
                padding="sm"
                className="flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <Link
                    href={`/admin/teams/${encodeURIComponent(team.teamId)}`}
                    className="break-words font-medium text-zinc-900 underline dark:text-zinc-50"
                  >
                    {team.name}
                  </Link>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {team.status === "active" ? adminCopy.teams.statusActive : adminCopy.teams.statusDisabled}{" "}
                    · {adminCopy.teams.teamIdLabel} {team.teamId}
                  </p>
                  {action.status === "error" && (
                    <Alert variant="error" className="mt-1 text-sm">
                      {action.message}
                    </Alert>
                  )}
                </div>
                <Button
                  variant={isDisabling ? "destructive" : "secondary"}
                  size="sm"
                  className="shrink-0"
                  pending={action.status === "pending"}
                  onClick={() => handleSetStatus(token, generation, team.teamId, nextStatus)}
                >
                  {action.status === "pending"
                    ? adminCopy.teams.updatingButton
                    : isDisabling
                      ? adminCopy.teams.disableButton
                      : adminCopy.teams.enableButton}
                </Button>
              </Card>
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
      <Link href="/sign-in" className="font-medium text-zinc-900 underline dark:text-zinc-50">
        {adminCopy.teams.signInLink}
      </Link>{" "}
      {adminCopy.teams.signInPrompt}
    </p>
  );
}

"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Alert } from "../../../components/ui/Alert";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { Button, buttonClassName } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Icon } from "../../../components/ui/Icon";
import { AdminTeamsListSkeleton } from "./TeamAdminSkeletons";
import { TextField } from "../../../components/ui/TextField";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { adminCopy } from "../copy";
import {
  createAdminTeam,
  fetchAdminTeams,
  setAdminTeamStatus,
  type AdminTeamsFetchResult,
} from "../client/admin-teams-gateway";
import type { TeamStatus } from "../domain/team";
import { matchesSearchQuery } from "../../../components/ui/search-match";
import { TeamIdentity } from "./TeamIdentity";

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

/** Status filter for the team list. Client-side only; it narrows already-loaded teams and never sends a request. */
type TeamStatusFilter = "all" | "active" | "disabled";

const STATUS_FILTERS: ReadonlyArray<{ id: TeamStatusFilter; label: string }> = [
  { id: "all", label: adminCopy.teams.filterAll },
  { id: "active", label: adminCopy.teams.filterActive },
  { id: "disabled", label: adminCopy.teams.filterDisabled },
];

function createErrorMessage(error: string): string {
  if (error === "invalid_name") {
    return adminCopy.teams.createError.invalidName;
  }
  return adminCopy.teams.createError.generic;
}

/**
 * Admin-only `/admin/teams` page (docs/archive/features/team-management/SPEC.md —
 * BR-1, BR-2, BR-3 UI). Mirrors `TeamsOverview`/`TeamDetail`'s client-side
 * auth-state and generation-guard pattern via the shared
 * `useAuthGatedResource` hook: the client holds the Firebase ID token (no
 * server session) and every admin operation (`listTeams`, `createTeam`,
 * `setTeamStatus`) is re-authorized server-side on every call via the
 * existing, unchanged TASK-001 `requireAppAdmin` boundary — this component
 * never decides admin status itself, and the superadmin registry never reaches
 * the client in any form.
 *
 * The shared hook's generation guard invalidates the initial list load, the
 * post-create refresh, and the post-status-change refresh alike on every
 * auth-state change (sign-out, account switch, token refresh) and on
 * unmount — a slow response for a superseded identity can never overwrite
 * what's currently shown, and a caller whose auth changes mid-operation
 * fails closed (the stale result is simply discarded, not rendered as if
 * it belonged to the new identity).
 *
 * Search and status filtering run over the already-loaded list (name and status only). They are reset on every auth-state
 * change, so one account's filter text is never carried into another account's view.
 */
export function AdminTeams() {
  const [state, setState] = useState<ViewState>({ phase: "loading" });
  const [createState, setCreateState] = useState<CreateState>({ status: "idle" });
  const [name, setName] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [statusActions, setStatusActions] = useState<Record<string, StatusActionState>>({});
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<TeamStatusFilter>("all");

  const { isCurrentGeneration } = useAuthGatedResource((token, generation) => {
    // A new auth state starts clean: no stale create/status-action
    // indicator from a previous identity can carry over.
    setCreateState({ status: "idle" });
    setStatusActions({});
    setName("");
    setFormOpen(false);
    setQuery("");
    setStatusFilter("all");

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
    setFormOpen(false);
    // Re-fetch the authoritative list rather than fabricating the new team
    // client-side — the server is the only source of truth for its final
    // shape (and for whether it actually persisted).
    await loadForGeneration(token, generation);
  }

  /**
   * Closes the creation form without creating anything (docs/archive/features/
   * ui-refresh/SPEC.md — BR-14). Unmounting the form on collapse is
   * acceptable per `SkillTreeCorrectionForm`'s existing precedent — any
   * in-progress, unsubmitted name is discarded, never any already-submitted
   * server state.
   */
  function handleCancel() {
    setFormOpen(false);
    setName("");
    setCreateState({ status: "idle" });
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
    return <AdminTeamsListSkeleton label={adminCopy.teams.loading} />;
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
    // caller is an active superadmin in the registry.
    return <Alert variant="error">{adminCopy.teams.forbidden}</Alert>;
  }

  if (result.status === "read_failed") {
    return <Alert variant="error">{adminCopy.teams.error}</Alert>;
  }

  const { teams } = result;
  const activeCount = teams.filter((team) => team.status === "active").length;
  const disabledCount = teams.length - activeCount;
  const visibleTeams = teams.filter(
    (team) =>
      (statusFilter === "all" || team.status === statusFilter) && matchesSearchQuery(query, [team.name]),
  );
  const isSearching = query.trim() !== "";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {teams.length > 0 ? (
          <dl className="flex flex-wrap gap-2">
            <TeamStat label={adminCopy.teams.activeTeamsLabel} value={activeCount} />
            <TeamStat label={adminCopy.teams.disabledTeamsLabel} value={disabledCount} />
            <TeamStat label={adminCopy.teams.totalTeamsLabel} value={teams.length} />
          </dl>
        ) : null}
        <Button
          type="button"
          variant="primary"
          size="sm"
          className="ml-auto inline-flex shrink-0 items-center gap-2"
          aria-expanded={formOpen}
          aria-controls="admin-team-create-form"
          onClick={() => setFormOpen((prev) => !prev)}
        >
          <Icon icon={Plus} size="inline" />
          {adminCopy.teams.newTeamButton}
        </Button>
      </div>

      {formOpen && (
        <form
          id="admin-team-create-form"
          onSubmit={(event) => handleCreate(event, token, generation)}
          className="flex flex-col gap-3"
        >
          <TextField
            id="admin-new-team-name"
            label={adminCopy.teams.newTeamNameLabel}
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={createState.status === "error" ? createState.message : undefined}
          />
          <div className="flex gap-2">
            <Button type="submit" className="shrink-0" pending={createState.status === "pending"}>
              {createState.status === "pending" ? adminCopy.teams.creatingButton : adminCopy.teams.createButton}
            </Button>
            <Button type="button" variant="secondary" className="shrink-0" onClick={handleCancel}>
              {adminCopy.teams.cancelButton}
            </Button>
          </div>
        </form>
      )}

      {teams.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 sm:max-w-sm sm:flex-1">
            <TextField
              id="admin-team-search"
              type="search"
              label={adminCopy.teams.searchLabel}
              value={query}
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div role="group" aria-label={adminCopy.teams.filterLabel} className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((filter) => {
              const pressed = statusFilter === filter.id;
              return (
                <button
                  key={filter.id}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => setStatusFilter(filter.id)}
                  className={`rounded-control border px-3 py-1.5 text-sm font-medium transition-colors duration-micro ease-standard ${
                    pressed
                      ? "border-primary bg-primary-subtle text-text-primary"
                      : "border-border-subtle text-text-secondary hover:bg-surface-subtle hover:text-text-primary"
                  }`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {teams.length === 0 ? (
        <EmptyState>{adminCopy.teams.empty}</EmptyState>
      ) : visibleTeams.length === 0 ? (
        <EmptyState>{emptyFilterMessage(isSearching, statusFilter)}</EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleTeams.map((team) => {
            const action = statusActions[team.teamId] ?? { status: "idle" as const };
            const nextStatus: TeamStatus = team.status === "active" ? "disabled" : "active";
            const isDisabling = team.status === "active";

            return (
              <li
                key={team.teamId}
                className="flex flex-col overflow-hidden rounded-surface border border-border-subtle bg-surface shadow-card"
              >
                <TeamIdentity teamId={team.teamId} />
                <div className="flex flex-1 flex-col gap-3 px-4 py-4">
                  <div className="min-w-0">
                    <h2 className="break-words text-base font-semibold text-text-primary">{team.name}</h2>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <StatusBadge tone={team.status === "active" ? "success" : "neutral"}>
                        {team.status === "active" ? adminCopy.teams.statusActive : adminCopy.teams.statusDisabled}
                      </StatusBadge>
                      <span className="break-all text-help text-text-muted">
                        {adminCopy.teams.teamIdLabel} {team.teamId}
                      </span>
                    </div>
                  </div>
                  {action.status === "error" && (
                    <Alert variant="error" className="text-sm">
                      {action.message}
                    </Alert>
                  )}
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                    <Link
                      href={`/admin/teams/${encodeURIComponent(team.teamId)}`}
                      className={buttonClassName({ variant: "primary", size: "sm", className: "inline-flex items-center" })}
                    >
                      {adminCopy.teams.administerTeamButton}
                    </Link>
                    <Button
                      variant={isDisabling ? "destructive" : "secondary"}
                      size="sm"
                      pending={action.status === "pending"}
                      onClick={() => handleSetStatus(token, generation, team.teamId, nextStatus)}
                    >
                      {action.status === "pending"
                        ? adminCopy.teams.updatingButton
                        : isDisabling
                          ? adminCopy.teams.disableButton
                          : adminCopy.teams.enableButton}
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function emptyFilterMessage(isSearching: boolean, statusFilter: TeamStatusFilter): string {
  if (isSearching) {
    return `${adminCopy.teams.noSearchResults} ${adminCopy.teams.tryAnotherSearch}`;
  }
  if (statusFilter === "active") return adminCopy.teams.noActiveTeams;
  if (statusFilter === "disabled") return adminCopy.teams.noDisabledTeams;
  return adminCopy.teams.empty;
}

function TeamStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-2 rounded-control border border-border-subtle bg-surface px-3 py-1.5">
      <dt className="text-sm text-text-secondary">{label}</dt>
      <dd className="text-base font-semibold tabular-nums text-text-primary">{value}</dd>
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

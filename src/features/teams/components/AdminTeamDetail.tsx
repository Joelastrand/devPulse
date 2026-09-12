"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { adminCopy } from "../copy";
import {
  cancelTeamInvitation,
  fetchTeamAccessRequests,
  fetchTeamInvitations,
  fetchTeamMembers,
  inviteTeamMember,
  removeAdminTeamMember,
  resolveAccessRequest,
  type AdminPendingAccessRequestEntry,
  type AdminPendingInvitationEntry,
  type AdminTeamMemberEntry,
} from "../client/admin-team-detail-gateway";
import { fetchAdminTeams } from "../client/admin-teams-gateway";
import type { TeamStatus } from "../domain/team";

interface TeamSummary {
  teamId: string;
  name: string;
  status: TeamStatus;
}

/**
 * The composed result this component renders — combines the existing
 * TASK-009 admin team catalog (for the team's name/status) with the
 * TASK-004/TASK-005 member/invitation/access-request lists. No new server
 * logic is introduced; this only reads from existing, unchanged endpoints.
 */
type TeamDetailResult =
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "read_failed" }
  | { status: "not_found" }
  | {
      status: "ok";
      team: TeamSummary;
      members: AdminTeamMemberEntry[];
      invitations: AdminPendingInvitationEntry[];
      requests: AdminPendingAccessRequestEntry[];
    };

async function loadTeamDetail(idToken: string, teamId: string): Promise<TeamDetailResult> {
  const [teamsResult, membersResult, invitationsResult, requestsResult] = await Promise.all([
    fetchAdminTeams(idToken),
    fetchTeamMembers(idToken, teamId),
    fetchTeamInvitations(idToken, teamId),
    fetchTeamAccessRequests(idToken, teamId),
  ]);

  const statuses = [
    teamsResult.status,
    membersResult.status,
    invitationsResult.status,
    requestsResult.status,
  ];

  if (statuses.includes("unauthenticated")) {
    return { status: "unauthenticated" };
  }
  if (statuses.includes("forbidden")) {
    return { status: "forbidden" };
  }
  if (
    teamsResult.status !== "ok" ||
    membersResult.status !== "ok" ||
    invitationsResult.status !== "ok" ||
    requestsResult.status !== "ok"
  ) {
    return { status: "read_failed" };
  }

  const team = teamsResult.teams.find((entry) => entry.teamId === teamId);
  if (!team) {
    return { status: "not_found" };
  }

  return {
    status: "ok",
    team,
    members: membersResult.members,
    invitations: invitationsResult.invitations,
    requests: requestsResult.requests,
  };
}

type ViewState =
  | { phase: "loading" }
  | { phase: "signed_out" }
  | { phase: "loaded"; token: string; generation: number; result: TeamDetailResult };

type InviteState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "error"; message: string };

type RowActionState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "error"; message: string };

/**
 * Approve and Reject share one guard per request (only one of the two may
 * be in flight at a time — an approve and a reject for the same request
 * must never both fire), but the UI still needs to know *which* of the two
 * is pending so only the clicked button shows a pending label; the other
 * is merely disabled, never mislabeled as busy.
 */
type RequestActionState =
  | { status: "idle" }
  | { status: "pending"; action: "approve" | "reject" }
  | { status: "error"; message: string };

function inviteErrorMessage(
  error:
    | "unauthenticated"
    | "forbidden"
    | "invalid_email"
    | "team_not_found"
    | "team_disabled"
    | "lookup_failed"
    | "persistence_failed"
    | "unknown",
): string {
  if (error === "invalid_email") {
    return adminCopy.detail.inviteError.invalidEmail;
  }
  if (error === "team_disabled") {
    return adminCopy.detail.inviteError.teamDisabled;
  }
  return adminCopy.detail.inviteError.generic;
}

/**
 * Admin-only `/admin/teams/[teamId]` detail page
 * (docs/features/team-management/SPEC.md — BR-17, BR-19, BR-21, BR-26,
 * BR-27, BR-29, BR-30 UI). Reuses TASK-009's admin shell and calls
 * TASK-004/TASK-005's existing server operations directly — no new server
 * logic. Mirrors `AdminTeams`'s client-side auth-state and generation-guard
 * pattern via the shared `useAuthGatedResource` hook, with `teamId` as an
 * extra reset dependency: every async operation is applied only if the
 * generation it started under is still current, so a slow response for a
 * superseded identity or a torn-down route can never overwrite what's
 * currently shown.
 */
export function AdminTeamDetail({ teamId }: { teamId: string }) {
  const [state, setState] = useState<ViewState>({ phase: "loading" });
  const [inviteState, setInviteState] = useState<InviteState>({ status: "idle" });
  const [email, setEmail] = useState("");
  const [memberActions, setMemberActions] = useState<Record<string, RowActionState>>({});
  const [invitationActions, setInvitationActions] = useState<Record<string, RowActionState>>({});
  const [requestActions, setRequestActions] = useState<Record<string, RequestActionState>>({});

  const { isCurrentGeneration } = useAuthGatedResource(
    (token, generation) => {
      setInviteState({ status: "idle" });
      setEmail("");
      setMemberActions({});
      setInvitationActions({});
      setRequestActions({});

      if (!token) {
        setState({ phase: "signed_out" });
        return;
      }

      setState({ phase: "loading" });
      loadForGeneration(token, generation);
    },
    [teamId],
  );

  /**
   * A hoisted function declaration (not `useCallback`) so it can be
   * referenced above, in the auth-change callback, without an
   * evaluation-order issue — it no longer needs to be memoized for an
   * effect's dependency array now that the subscription (and the `teamId`
   * route-change guard) lives inside `useAuthGatedResource`.
   */
  async function loadForGeneration(token: string, generation: number) {
    const result = await loadTeamDetail(token, teamId);
    if (isCurrentGeneration(generation)) {
      setState({ phase: "loaded", token, generation, result });
    }
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>, token: string, generation: number) {
    event.preventDefault();
    if (inviteState.status === "pending") {
      return;
    }

    setInviteState({ status: "pending" });
    const result = await inviteTeamMember(token, teamId, email);

    if (!isCurrentGeneration(generation)) {
      return;
    }

    if (!result.ok) {
      setInviteState({ status: "error", message: inviteErrorMessage(result.error) });
      return;
    }

    setInviteState({ status: "idle" });
    setEmail("");
    await loadForGeneration(token, generation);
  }

  async function handleRemoveMember(token: string, generation: number, uid: string) {
    if (memberActions[uid]?.status === "pending") {
      return;
    }
    setMemberActions((prev) => ({ ...prev, [uid]: { status: "pending" } }));

    const result = await removeAdminTeamMember(token, teamId, uid);

    if (!isCurrentGeneration(generation)) {
      return;
    }

    if (!result.ok) {
      setMemberActions((prev) => ({
        ...prev,
        [uid]: { status: "error", message: adminCopy.detail.rowError },
      }));
      return;
    }

    setMemberActions((prev) => ({ ...prev, [uid]: { status: "idle" } }));
    await loadForGeneration(token, generation);
  }

  async function handleCancelInvitation(token: string, generation: number, invitationEmail: string) {
    if (invitationActions[invitationEmail]?.status === "pending") {
      return;
    }
    setInvitationActions((prev) => ({ ...prev, [invitationEmail]: { status: "pending" } }));

    const result = await cancelTeamInvitation(token, teamId, invitationEmail);

    if (!isCurrentGeneration(generation)) {
      return;
    }

    if (!result.ok) {
      setInvitationActions((prev) => ({
        ...prev,
        [invitationEmail]: { status: "error", message: adminCopy.detail.rowError },
      }));
      return;
    }

    setInvitationActions((prev) => ({ ...prev, [invitationEmail]: { status: "idle" } }));
    await loadForGeneration(token, generation);
  }

  async function handleResolveRequest(
    token: string,
    generation: number,
    uid: string,
    status: "approved" | "rejected",
  ) {
    if (requestActions[uid]?.status === "pending") {
      return;
    }
    const action = status === "approved" ? "approve" : "reject";
    setRequestActions((prev) => ({ ...prev, [uid]: { status: "pending", action } }));

    const result = await resolveAccessRequest(token, teamId, uid, status);

    if (!isCurrentGeneration(generation)) {
      return;
    }

    if (!result.ok) {
      setRequestActions((prev) => ({
        ...prev,
        [uid]: { status: "error", message: adminCopy.detail.rowError },
      }));
      return;
    }

    setRequestActions((prev) => ({ ...prev, [uid]: { status: "idle" } }));
    await loadForGeneration(token, generation);
  }

  if (state.phase === "loading") {
    return <LoadingState label={adminCopy.detail.loading} />;
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
    return <Alert variant="error">{adminCopy.detail.forbidden}</Alert>;
  }

  if (result.status === "read_failed") {
    return <Alert variant="error">{adminCopy.detail.error}</Alert>;
  }

  if (result.status === "not_found") {
    return <Alert variant="error">{adminCopy.detail.notFound}</Alert>;
  }

  const { team, members, invitations, requests } = result;

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title={team.name}
        description={`${team.status === "active" ? adminCopy.teams.statusActive : adminCopy.teams.statusDisabled} · ${adminCopy.teams.teamIdLabel} ${team.teamId}`}
      />

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
          {adminCopy.detail.inviteSectionTitle}
        </h2>
        <form
          onSubmit={(event) => handleInvite(event, token, generation)}
          className="flex flex-col gap-2"
        >
          <label
            htmlFor="admin-invite-email"
            className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
          >
            {adminCopy.detail.emailLabel}
          </label>
          <div className="flex gap-2">
            <input
              id="admin-invite-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="flex-1 rounded border border-zinc-300 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
            <Button type="submit" className="shrink-0" pending={inviteState.status === "pending"}>
              {inviteState.status === "pending" ? adminCopy.detail.invitingButton : adminCopy.detail.inviteButton}
            </Button>
          </div>
          {inviteState.status === "error" && (
            <Alert variant="error" className="text-sm">
              {inviteState.message}
            </Alert>
          )}
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
          {adminCopy.detail.membersSectionTitle}
        </h2>
        {members.length === 0 ? (
          <EmptyState>{adminCopy.detail.noMembers}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {members.map((member) => {
              const action = memberActions[member.uid] ?? { status: "idle" as const };
              return (
                <Card
                  as="li"
                  key={member.uid}
                  variant="bordered"
                  padding="sm"
                  className="flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="break-words font-medium text-zinc-900 dark:text-zinc-50">
                      {member.email ?? member.uid}
                    </p>
                    {action.status === "error" && (
                      <Alert variant="error" className="mt-1 text-sm">
                        {action.message}
                      </Alert>
                    )}
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="shrink-0"
                    pending={action.status === "pending"}
                    onClick={() => handleRemoveMember(token, generation, member.uid)}
                  >
                    {action.status === "pending" ? adminCopy.detail.removingButton : adminCopy.detail.removeButton}
                  </Button>
                </Card>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
          {adminCopy.detail.invitationsSectionTitle}
        </h2>
        {invitations.length === 0 ? (
          <EmptyState>{adminCopy.detail.noInvitations}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {invitations.map((invitation) => {
              const action = invitationActions[invitation.email] ?? { status: "idle" as const };
              return (
                <Card
                  as="li"
                  key={invitation.email}
                  variant="bordered"
                  padding="sm"
                  className="flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="break-words font-medium text-zinc-900 dark:text-zinc-50">{invitation.email}</p>
                    {action.status === "error" && (
                      <Alert variant="error" className="mt-1 text-sm">
                        {action.message}
                      </Alert>
                    )}
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="shrink-0"
                    pending={action.status === "pending"}
                    onClick={() => handleCancelInvitation(token, generation, invitation.email)}
                  >
                    {action.status === "pending"
                      ? adminCopy.detail.cancelingButton
                      : adminCopy.detail.cancelInvitationButton}
                  </Button>
                </Card>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
          {adminCopy.detail.requestsSectionTitle}
        </h2>
        {requests.length === 0 ? (
          <EmptyState>{adminCopy.detail.noRequests}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {requests.map((request) => {
              const action = requestActions[request.uid] ?? { status: "idle" as const };
              const isPending = action.status === "pending";
              // Only the clicked button ever shows a pending label — the
              // other is disabled (the shared guard) but never mislabeled
              // as the one in flight.
              const isApprovePending = action.status === "pending" && action.action === "approve";
              const isRejectPending = action.status === "pending" && action.action === "reject";
              return (
                <Card
                  as="li"
                  key={request.uid}
                  variant="bordered"
                  padding="sm"
                  className="flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="break-words font-medium text-zinc-900 dark:text-zinc-50">
                      {request.email ?? request.uid}
                    </p>
                    {action.status === "error" && (
                      <Alert variant="error" className="mt-1 text-sm">
                        {action.message}
                      </Alert>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={isPending}
                      pending={isRejectPending}
                      onClick={() => handleResolveRequest(token, generation, request.uid, "rejected")}
                    >
                      {isRejectPending ? adminCopy.detail.rejectingButton : adminCopy.detail.rejectButton}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={isPending}
                      pending={isApprovePending}
                      onClick={() => handleResolveRequest(token, generation, request.uid, "approved")}
                    >
                      {isApprovePending ? adminCopy.detail.approvingButton : adminCopy.detail.approveButton}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function SignInPrompt() {
  return (
    <p className="text-zinc-600 dark:text-zinc-400">
      <Link href="/sign-in" className="font-medium text-zinc-900 underline dark:text-zinc-50">
        {adminCopy.detail.signInLink}
      </Link>{" "}
      {adminCopy.detail.signInPrompt}
    </p>
  );
}

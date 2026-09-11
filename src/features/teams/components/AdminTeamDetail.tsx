"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { observeIdToken } from "../../auth/client/auth-client";
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
    return "Enter a valid email address.";
  }
  if (error === "team_disabled") {
    return "This team is disabled. Re-enable it before inviting members.";
  }
  return "Something went wrong sending this invitation. Please try again.";
}

const GENERIC_ROW_ERROR = "Something went wrong. Please try again.";

/**
 * Admin-only `/admin/teams/[teamId]` detail page
 * (docs/features/team-management/SPEC.md — BR-17, BR-19, BR-21, BR-26,
 * BR-27, BR-29, BR-30 UI). Reuses TASK-009's admin shell and calls
 * TASK-004/TASK-005's existing server operations directly — no new server
 * logic. Mirrors `AdminTeams`'s client-side auth-state and generation-guard
 * pattern exactly: every async operation is applied only if the generation
 * it started under is still current, so a slow response for a superseded
 * identity or a torn-down route can never overwrite what's currently shown.
 */
export function AdminTeamDetail({ teamId }: { teamId: string }) {
  const [state, setState] = useState<ViewState>({ phase: "loading" });
  const [inviteState, setInviteState] = useState<InviteState>({ status: "idle" });
  const [email, setEmail] = useState("");
  const [memberActions, setMemberActions] = useState<Record<string, RowActionState>>({});
  const [invitationActions, setInvitationActions] = useState<Record<string, RowActionState>>({});
  const [requestActions, setRequestActions] = useState<Record<string, RequestActionState>>({});
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
    });

    return () => {
      generationRef.current += 1;
      unsubscribe();
    };
  }, [teamId, loadForGeneration]);

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
      setMemberActions((prev) => ({ ...prev, [uid]: { status: "error", message: GENERIC_ROW_ERROR } }));
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
        [invitationEmail]: { status: "error", message: GENERIC_ROW_ERROR },
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
      setRequestActions((prev) => ({ ...prev, [uid]: { status: "error", message: GENERIC_ROW_ERROR } }));
      return;
    }

    setRequestActions((prev) => ({ ...prev, [uid]: { status: "idle" } }));
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

  if (result.status === "forbidden") {
    return (
      <p role="alert" className="text-red-700 dark:text-red-400">
        You don&apos;t have permission to view this page.
      </p>
    );
  }

  if (result.status === "read_failed") {
    return (
      <p role="alert" className="text-red-700 dark:text-red-400">
        Something went wrong loading this team. Please try again later.
      </p>
    );
  }

  if (result.status === "not_found") {
    return (
      <p role="alert" className="text-red-700 dark:text-red-400">
        This team could not be found.
      </p>
    );
  }

  const { team, members, invitations, requests } = result;

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{team.name}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {team.status === "active" ? "Active" : "Disabled"} · {team.teamId}
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">Invite a member</h2>
        <form
          onSubmit={(event) => handleInvite(event, token, generation)}
          className="flex flex-col gap-2"
        >
          <label
            htmlFor="admin-invite-email"
            className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
          >
            Email address
          </label>
          <div className="flex gap-2">
            <input
              id="admin-invite-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="flex-1 rounded border border-zinc-300 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              type="submit"
              disabled={inviteState.status === "pending"}
              className="shrink-0 rounded-full bg-foreground px-5 py-2 text-background transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {inviteState.status === "pending" ? "Inviting…" : "Invite"}
            </button>
          </div>
          {inviteState.status === "error" && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {inviteState.message}
            </p>
          )}
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">Members</h2>
        {members.length === 0 ? (
          <p role="status" className="text-zinc-600 dark:text-zinc-400">
            No members yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {members.map((member) => {
              const action = memberActions[member.uid] ?? { status: "idle" as const };
              return (
                <li
                  key={member.uid}
                  className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
                >
                  <div>
                    <p className="font-medium text-zinc-900 dark:text-zinc-50">
                      {member.email ?? member.uid}
                    </p>
                    {action.status === "error" && (
                      <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
                        {action.message}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveMember(token, generation, member.uid)}
                    disabled={action.status === "pending"}
                    className="shrink-0 rounded-full border border-red-300 px-4 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                  >
                    {action.status === "pending" ? "Removing…" : "Remove"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">Pending invitations</h2>
        {invitations.length === 0 ? (
          <p role="status" className="text-zinc-600 dark:text-zinc-400">
            No pending invitations.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {invitations.map((invitation) => {
              const action = invitationActions[invitation.email] ?? { status: "idle" as const };
              return (
                <li
                  key={invitation.email}
                  className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
                >
                  <div>
                    <p className="font-medium text-zinc-900 dark:text-zinc-50">{invitation.email}</p>
                    {action.status === "error" && (
                      <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
                        {action.message}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCancelInvitation(token, generation, invitation.email)}
                    disabled={action.status === "pending"}
                    className="shrink-0 rounded-full border border-red-300 px-4 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                  >
                    {action.status === "pending" ? "Canceling…" : "Cancel invitation"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
          Pending access requests
        </h2>
        {requests.length === 0 ? (
          <p role="status" className="text-zinc-600 dark:text-zinc-400">
            No pending access requests.
          </p>
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
                <li
                  key={request.uid}
                  className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
                >
                  <div>
                    <p className="font-medium text-zinc-900 dark:text-zinc-50">
                      {request.email ?? request.uid}
                    </p>
                    {action.status === "error" && (
                      <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
                        {action.message}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => handleResolveRequest(token, generation, request.uid, "rejected")}
                      disabled={isPending}
                      className="rounded-full border border-red-300 px-4 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                    >
                      {isRejectPending ? "Rejecting…" : "Reject"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResolveRequest(token, generation, request.uid, "approved")}
                      disabled={isPending}
                      className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
                    >
                      {isApprovePending ? "Approving…" : "Approve"}
                    </button>
                  </div>
                </li>
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
      <a href="/sign-in" className="font-medium text-zinc-900 underline dark:text-zinc-50">
        Sign in
      </a>{" "}
      to manage this team.
    </p>
  );
}

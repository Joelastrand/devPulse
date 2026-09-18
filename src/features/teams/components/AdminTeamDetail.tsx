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
import {
  archiveAdminChallenge,
  deleteAdminChallenge,
  fetchAdminChallenges,
  resolveAdminChallenge,
  type AdminChallengeView,
  type FetchAdminChallengesResult,
} from "../../challenges/client/admin-challenges-gateway";
import {
  AdminChallengeList,
  type AdminChallengeListState,
  type AdminChallengeRowActionState,
} from "../../challenges/components/AdminChallengeList";
import { challengesCopy } from "../../challenges/copy";
import {
  closeAdminSurvey,
  createAdminSurvey,
  deleteOrArchiveAdminSurvey,
  fetchAdminSurveys,
  openAdminSurvey,
  type AdminSurveyEntry,
  type SurveyAccessMode,
} from "../../surveys/client/admin-survey-gateway";
import { surveysCopy } from "../../surveys/copy";
import {
  fetchAdminSkillTrees,
  fetchTeamSkills,
  startAdminTeamSkillTracking,
  updateAdminTeamSkillProgress,
  stopAdminTeamSkillTracking,
  type AdminSkillTreeEntry,
  type FetchAdminSkillTreesResult,
  type FetchTeamSkillsResult,
  type StartAdminTeamSkillTrackingResult,
  type TeamSkillView,
  type UpdateAdminTeamSkillProgressResult,
} from "../../skill-trees/client/skill-trees-gateway";
import {
  TeamSkillTrackingSection,
  type TeamSkillCatalogState,
  type TeamSkillRowActionState,
  type TeamSkillTrackingState,
} from "../../skill-trees/components/TeamSkillTrackingSection";
import { teamSkillTrackingCopy } from "../../skill-trees/copy";
import {
  DEFAULT_MINIMUM_RESPONSES,
  MINIMUM_RESPONSES_MAX,
  MINIMUM_RESPONSES_MIN,
} from "../../surveys/domain/survey";
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
 * The Anonymous Challenges section's own composed state, resolved
 * independently of the team/members/invitations/requests/surveys read above
 * it (docs/features/anonymous-challenges/SPEC.md — TASK-006: a challenge
 * read failure must not erase any other section, mirroring `TeamDetail.tsx`'s
 * `ChallengesSectionState`/`CurrentSurveySectionState` pattern). `"unavailable"`
 * covers both a genuine read failure and a rare authorization race — never
 * fabricated as "no challenges yet" in either case.
 */
type ChallengesSectionState =
  | { status: "loaded"; challenges: AdminChallengeView[] }
  | { status: "unavailable" };

function toChallengesSectionState(result: FetchAdminChallengesResult): ChallengesSectionState {
  return result.status === "ok"
    ? { status: "loaded", challenges: result.challenges }
    : { status: "unavailable" };
}

/**
 * The TASK-006 SkillTree catalog section's own composed state, resolved
 * independently of the rest of the page (docs/features/team-skill-tree/
 * SPEC.md — TASK-006), mirroring `ChallengesSectionState`: a catalog read
 * failure must not erase any other section of `/admin/teams/[teamId]`.
 */
type SkillCatalogSectionState =
  | { status: "loaded"; trees: AdminSkillTreeEntry[] }
  | { status: "unavailable" };

function toSkillCatalogSectionState(result: FetchAdminSkillTreesResult): SkillCatalogSectionState {
  return result.status === "ok" ? { status: "loaded", trees: result.trees } : { status: "unavailable" };
}

/**
 * The persisted skill-tracking-state section (TASK-008 closeout fix for the
 * TASK-006/TASK-007 admin-reload finding — docs/features/team-skill-tree/
 * TASKS.md, TASK-007's "TASK-008 closeout finding"). TASK-006 originally
 * derived "which trees are tracked, and their current stage" purely from
 * this session's own start/update/stop calls because it owned no read
 * endpoint at the time; TASK-007 has since delivered the approved
 * `GET /api/teams/[teamId]/skills` → `getTeamSkillProgress` read contract,
 * which an app admin is already an authorized reader of via
 * `authorizeTeamAccess` (BR-18) regardless of real team membership. This
 * section reuses that exact, unchanged read path — no new endpoint, no new
 * authorization architecture — so a fresh render of this page reconstructs
 * actually-persisted tracking state instead of starting every catalog tree
 * "untracked" again. Mirrors `ChallengesSectionState`/`SkillCatalogSectionState`:
 * a read failure here degrades gracefully to the pre-fix "nothing known yet"
 * behavior rather than erasing any other section.
 */
type SkillProgressSectionState =
  | { status: "loaded"; skills: TeamSkillView[] }
  | { status: "unavailable" };

function toSkillProgressSectionState(result: FetchTeamSkillsResult): SkillProgressSectionState {
  return result.status === "ok" ? { status: "loaded", skills: result.skills } : { status: "unavailable" };
}

/** Seeds the session's `skillTracking` map from the persisted read above — every returned tree is "tracked" at its actual `currentNodeId`; a tree absent from the list is left for `TeamSkillTrackingSection` to treat as untracked, exactly as it already does for a tree missing from the map. */
function toInitialSkillTracking(state: SkillProgressSectionState): Record<string, TeamSkillTrackingState> {
  if (state.status !== "loaded") {
    return {};
  }
  const tracking: Record<string, TeamSkillTrackingState> = {};
  for (const skill of state.skills) {
    tracking[skill.treeId] = { status: "tracked", currentNodeId: skill.currentNodeId };
  }
  return tracking;
}

/**
 * The composed result this component renders — combines the existing
 * TASK-009 admin team catalog (for the team's name/status) with the
 * TASK-004/TASK-005 member/invitation/access-request lists, TASK-006's
 * independently-resolved challenges section, and this closeout's persisted
 * skill-progress section. No new server logic is introduced; this only
 * reads from existing, unchanged endpoints.
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
      surveys: AdminSurveyEntry[];
      challenges: ChallengesSectionState;
      skillCatalog: SkillCatalogSectionState;
      skillProgress: SkillProgressSectionState;
    };

async function loadTeamDetail(idToken: string, teamId: string): Promise<TeamDetailResult> {
  // Challenges, the skill-tree catalog, and the team's persisted skill
  // progress are fetched in the same parallel batch but deliberately
  // excluded from the gate below — a challenges-, catalog-, or
  // progress-only read failure must never erase team/members/invitations/
  // requests/surveys, and vice versa (mirrors `TeamDetail.tsx`'s
  // independent-section pattern, extended in TASK-006 to the skill-tree
  // catalog and in this TASK-008 closeout fix to persisted skill progress).
  const [
    teamsResult,
    membersResult,
    invitationsResult,
    requestsResult,
    surveysResult,
    challengesResult,
    skillCatalogResult,
    skillProgressResult,
  ] = await Promise.all([
    fetchAdminTeams(idToken),
    fetchTeamMembers(idToken, teamId),
    fetchTeamInvitations(idToken, teamId),
    fetchTeamAccessRequests(idToken, teamId),
    fetchAdminSurveys(idToken, teamId),
    fetchAdminChallenges(idToken, teamId),
    fetchAdminSkillTrees(idToken),
    fetchTeamSkills(idToken, teamId),
  ]);

  const statuses = [
    teamsResult.status,
    membersResult.status,
    invitationsResult.status,
    requestsResult.status,
    surveysResult.status,
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
    requestsResult.status !== "ok" ||
    surveysResult.status !== "ok"
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
    surveys: surveysResult.surveys,
    challenges: toChallengesSectionState(challengesResult),
    skillCatalog: toSkillCatalogSectionState(skillCatalogResult),
    skillProgress: toSkillProgressSectionState(skillProgressResult),
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

type SurveyCreateState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "error"; message: string };

/**
 * Per-survey action state. Only one lifecycle-driven action is ever
 * offered for a given row at a time (scheduled → open only; open → close
 * only; closed & not archived → remove only) — unlike the access-request
 * approve/reject pair, no two actions ever compete for the same row, so a
 * plain per-survey state (mirroring `RowActionState`) is enough, with one
 * extra phase (`confirming_removal`) for the destructive remove action's
 * explicit confirmation step (docs/features/managed-surveys/SPEC.md —
 * BR-37, `docs/UI-UX.md` → "Admin UX").
 */
type SurveyRowActionState =
  | { status: "idle" }
  | { status: "confirming_removal" }
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

function skillStartErrorMessage(error: Exclude<StartAdminTeamSkillTrackingResult, { ok: true }>["error"]): string {
  if (error === "team_disabled") return teamSkillTrackingCopy.untracked.error.teamDisabled;
  if (error === "tree_not_found") return teamSkillTrackingCopy.untracked.error.treeNotFound;
  if (error === "team_not_found") return teamSkillTrackingCopy.untracked.error.teamNotFound;
  return teamSkillTrackingCopy.untracked.error.generic;
}

function skillStageErrorMessage(
  error: Exclude<UpdateAdminTeamSkillProgressResult, { ok: true }>["error"],
): string {
  if (error === "not_tracked") return teamSkillTrackingCopy.tracked.error.notTracked;
  if (error === "invalid_input") return teamSkillTrackingCopy.tracked.error.invalidInput;
  return teamSkillTrackingCopy.tracked.error.generic;
}

function surveyLifecycleLabel(entry: AdminSurveyEntry): string {
  return surveysCopy.admin.lifecycleLabels[entry.lifecycle];
}

function surveyAccessModeLabel(accessMode: SurveyAccessMode): string {
  return surveysCopy.admin.accessModeLabels[accessMode];
}

function surveyLink(surveyId: string): string {
  return `/survey/${encodeURIComponent(surveyId)}`;
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
  const [surveyCreateState, setSurveyCreateState] = useState<SurveyCreateState>({ status: "idle" });
  const [surveyAccessMode, setSurveyAccessMode] = useState<SurveyAccessMode | null>(null);
  const [surveyTitle, setSurveyTitle] = useState("");
  const [surveyMinimumResponses, setSurveyMinimumResponses] = useState(
    String(DEFAULT_MINIMUM_RESPONSES),
  );
  const [surveyStartAt, setSurveyStartAt] = useState("");
  const [surveyEndAt, setSurveyEndAt] = useState("");
  const [surveyActions, setSurveyActions] = useState<Record<string, SurveyRowActionState>>({});
  const [copiedSurveyId, setCopiedSurveyId] = useState<string | null>(null);
  const [challengeActions, setChallengeActions] = useState<Record<string, AdminChallengeRowActionState>>({});
  const [skillTracking, setSkillTracking] = useState<Record<string, TeamSkillTrackingState>>({});
  const [skillActions, setSkillActions] = useState<Record<string, TeamSkillRowActionState>>({});

  const { isCurrentGeneration } = useAuthGatedResource(
    (token, generation) => {
      setInviteState({ status: "idle" });
      setEmail("");
      setMemberActions({});
      setInvitationActions({});
      setRequestActions({});
      setSurveyCreateState({ status: "idle" });
      setSurveyAccessMode(null);
      setSurveyTitle("");
      setSurveyStartAt("");
      setSurveyEndAt("");
      setSurveyActions({});
      setCopiedSurveyId(null);
      setChallengeActions({});
      setSkillTracking({});
      setSkillActions({});

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
      // Reconstructs the session's `skillTracking` map from persisted state
      // on every (re)load, including the first one — a fresh render no
      // longer starts every catalog tree "untracked" regardless of what is
      // actually tracked in Firestore (TASK-008 closeout fix). A skill
      // mutation (`handleStartSkillTracking`/`handleSetSkillStage`/
      // `handleStopSkillTracking`) updates `skillTracking` directly and
      // never calls `loadForGeneration`, so this reseed never clobbers an
      // in-flight optimistic update.
      setSkillTracking(
        result.status === "ok" ? toInitialSkillTracking(result.skillProgress) : {},
      );
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

  async function handleCreateSurvey(event: FormEvent<HTMLFormElement>, token: string, generation: number) {
    event.preventDefault();
    if (surveyCreateState.status === "pending" || surveyAccessMode === null) {
      return;
    }

    setSurveyCreateState({ status: "pending" });
    const result = await createAdminSurvey(token, teamId, {
      accessMode: surveyAccessMode,
      // Parsed client-side for the request only — the server independently
      // validates this value and never relies on the UI's default or its
      // min/max attributes (docs/features/managed-surveys/SPEC.md —
      // "Per-survey result threshold": client input is always untrusted).
      minimumResponses: Number(surveyMinimumResponses),
      ...(surveyTitle.trim() !== "" ? { title: surveyTitle.trim() } : {}),
      ...(surveyStartAt !== "" ? { startAt: surveyStartAt } : {}),
      ...(surveyEndAt !== "" ? { endAt: surveyEndAt } : {}),
    });

    if (!isCurrentGeneration(generation)) {
      return;
    }

    if (!result.ok) {
      setSurveyCreateState({ status: "error", message: surveysCopy.admin.create.error });
      return;
    }

    setSurveyCreateState({ status: "idle" });
    setSurveyAccessMode(null);
    setSurveyTitle("");
    setSurveyMinimumResponses(String(DEFAULT_MINIMUM_RESPONSES));
    setSurveyStartAt("");
    setSurveyEndAt("");
    await loadForGeneration(token, generation);
  }

  async function handleOpenSurvey(token: string, generation: number, surveyId: string) {
    if (surveyActions[surveyId]?.status === "pending") {
      return;
    }
    setSurveyActions((prev) => ({ ...prev, [surveyId]: { status: "pending" } }));

    const result = await openAdminSurvey(token, teamId, surveyId);

    if (!isCurrentGeneration(generation)) {
      return;
    }

    if (!result.ok) {
      setSurveyActions((prev) => ({
        ...prev,
        [surveyId]: { status: "error", message: surveysCopy.admin.openError },
      }));
      return;
    }

    setSurveyActions((prev) => ({ ...prev, [surveyId]: { status: "idle" } }));
    await loadForGeneration(token, generation);
  }

  async function handleCloseSurvey(token: string, generation: number, surveyId: string) {
    if (surveyActions[surveyId]?.status === "pending") {
      return;
    }
    setSurveyActions((prev) => ({ ...prev, [surveyId]: { status: "pending" } }));

    const result = await closeAdminSurvey(token, teamId, surveyId);

    if (!isCurrentGeneration(generation)) {
      return;
    }

    if (!result.ok) {
      setSurveyActions((prev) => ({
        ...prev,
        [surveyId]: { status: "error", message: surveysCopy.admin.closeError },
      }));
      return;
    }

    setSurveyActions((prev) => ({ ...prev, [surveyId]: { status: "idle" } }));
    await loadForGeneration(token, generation);
  }

  function handleRequestRemoveSurvey(surveyId: string) {
    if (surveyActions[surveyId]?.status === "pending") {
      return;
    }
    setSurveyActions((prev) => ({ ...prev, [surveyId]: { status: "confirming_removal" } }));
  }

  function handleCancelRemoveSurvey(surveyId: string) {
    setSurveyActions((prev) => ({ ...prev, [surveyId]: { status: "idle" } }));
  }

  async function handleConfirmRemoveSurvey(token: string, generation: number, surveyId: string) {
    if (surveyActions[surveyId]?.status === "pending") {
      return;
    }
    setSurveyActions((prev) => ({ ...prev, [surveyId]: { status: "pending" } }));

    const result = await deleteOrArchiveAdminSurvey(token, teamId, surveyId);

    if (!isCurrentGeneration(generation)) {
      return;
    }

    if (!result.ok) {
      setSurveyActions((prev) => ({
        ...prev,
        [surveyId]: { status: "error", message: surveysCopy.admin.removeError },
      }));
      return;
    }

    setSurveyActions((prev) => ({ ...prev, [surveyId]: { status: "idle" } }));
    await loadForGeneration(token, generation);
  }

  async function handleCopySurveyLink(surveyId: string) {
    const url = `${window.location.origin}${surveyLink(surveyId)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      return;
    }
    setCopiedSurveyId(surveyId);
    setTimeout(() => setCopiedSurveyId((current) => (current === surveyId ? null : current)), 2000);
  }

  /**
   * Resolve/archive/delete each guard against a duplicate click for their
   * own row only (`challengeActions[challengeId]`) — resolving one
   * challenge never disables, shows pending, or overwrites the error state
   * of another (docs/features/anonymous-challenges/SPEC.md — TASK-006,
   * mirrors `SurveyRowActionState`'s existing per-row isolation). Every
   * result is applied only if `generation` is still current, and a
   * successful action always re-fetches the full authoritative view via
   * `loadForGeneration` — never a fabricated `resolvedAt`/`archivedAt`/
   * `status` — reusing this component's single existing auth subscription
   * rather than a second one.
   */
  async function handleResolveChallenge(token: string, generation: number, challengeId: string) {
    if (challengeActions[challengeId]?.status === "pending") {
      return;
    }
    setChallengeActions((prev) => ({ ...prev, [challengeId]: { status: "pending", action: "resolve" } }));

    const result = await resolveAdminChallenge(token, teamId, challengeId);

    if (!isCurrentGeneration(generation)) {
      return;
    }

    if (!result.ok) {
      setChallengeActions((prev) => ({
        ...prev,
        [challengeId]: { status: "error", message: challengesCopy.admin.resolveError },
      }));
      return;
    }

    setChallengeActions((prev) => ({ ...prev, [challengeId]: { status: "idle" } }));
    await loadForGeneration(token, generation);
  }

  async function handleArchiveChallenge(token: string, generation: number, challengeId: string) {
    if (challengeActions[challengeId]?.status === "pending") {
      return;
    }
    setChallengeActions((prev) => ({ ...prev, [challengeId]: { status: "pending", action: "archive" } }));

    const result = await archiveAdminChallenge(token, teamId, challengeId);

    if (!isCurrentGeneration(generation)) {
      return;
    }

    if (!result.ok) {
      setChallengeActions((prev) => ({
        ...prev,
        [challengeId]: { status: "error", message: challengesCopy.admin.archiveError },
      }));
      return;
    }

    setChallengeActions((prev) => ({ ...prev, [challengeId]: { status: "idle" } }));
    await loadForGeneration(token, generation);
  }

  function handleRequestDeleteChallenge(challengeId: string) {
    if (challengeActions[challengeId]?.status === "pending") {
      return;
    }
    setChallengeActions((prev) => ({ ...prev, [challengeId]: { status: "confirming_deletion" } }));
  }

  function handleCancelDeleteChallenge(challengeId: string) {
    setChallengeActions((prev) => ({ ...prev, [challengeId]: { status: "idle" } }));
  }

  async function handleConfirmDeleteChallenge(token: string, generation: number, challengeId: string) {
    if (challengeActions[challengeId]?.status === "pending") {
      return;
    }
    setChallengeActions((prev) => ({ ...prev, [challengeId]: { status: "pending", action: "delete" } }));

    const result = await deleteAdminChallenge(token, teamId, challengeId);

    if (!isCurrentGeneration(generation)) {
      return;
    }

    if (!result.ok) {
      setChallengeActions((prev) => ({
        ...prev,
        [challengeId]: { status: "error", message: challengesCopy.admin.deleteError },
      }));
      return;
    }

    setChallengeActions((prev) => ({ ...prev, [challengeId]: { status: "idle" } }));
    await loadForGeneration(token, generation);
  }

  /**
   * TASK-006's start/set-stage/stop handlers (docs/features/team-skill-tree/
   * SPEC.md — BR-27). Each guards its own row (`skillActions[treeId]`) the
   * same way `handleResolveChallenge`/`handleArchiveChallenge` do — one
   * pending action per row at a time — and, on success, updates
   * `skillTracking[treeId]` directly rather than re-fetching, since TASK-006
   * owns no read endpoint for this team's tracking state (see
   * `TeamSkillTrackingSection`'s module doc): the mutation's own known
   * outcome (`currentNodeId: null` on start, the selected `nodeId` on
   * update, "untracked" on stop) is the only state this session ever needs.
   */
  async function handleStartSkillTracking(token: string, generation: number, treeId: string) {
    if (skillActions[treeId]?.status === "pending") {
      return;
    }
    setSkillActions((prev) => ({ ...prev, [treeId]: { status: "pending", action: "start" } }));

    const result = await startAdminTeamSkillTracking(token, teamId, treeId);

    if (!isCurrentGeneration(generation)) {
      return;
    }

    if (!result.ok) {
      setSkillActions((prev) => ({
        ...prev,
        [treeId]: { status: "error", message: skillStartErrorMessage(result.error) },
      }));
      return;
    }

    setSkillTracking((prev) => ({ ...prev, [treeId]: { status: "tracked", currentNodeId: null } }));
    setSkillActions((prev) => ({ ...prev, [treeId]: { status: "idle" } }));
  }

  async function handleSetSkillStage(token: string, generation: number, treeId: string, nodeId: string) {
    if (skillActions[treeId]?.status === "pending") {
      return;
    }
    setSkillActions((prev) => ({ ...prev, [treeId]: { status: "pending", action: "setStage" } }));

    const result = await updateAdminTeamSkillProgress(token, teamId, treeId, nodeId);

    if (!isCurrentGeneration(generation)) {
      return;
    }

    if (!result.ok) {
      setSkillActions((prev) => ({
        ...prev,
        [treeId]: { status: "error", message: skillStageErrorMessage(result.error) },
      }));
      return;
    }

    setSkillTracking((prev) => ({ ...prev, [treeId]: { status: "tracked", currentNodeId: nodeId } }));
    setSkillActions((prev) => ({ ...prev, [treeId]: { status: "idle" } }));
  }

  async function handleStopSkillTracking(token: string, generation: number, treeId: string) {
    if (skillActions[treeId]?.status === "pending") {
      return;
    }
    setSkillActions((prev) => ({ ...prev, [treeId]: { status: "pending", action: "stop" } }));

    const result = await stopAdminTeamSkillTracking(token, teamId, treeId);

    if (!isCurrentGeneration(generation)) {
      return;
    }

    if (!result.ok) {
      setSkillActions((prev) => ({
        ...prev,
        [treeId]: { status: "error", message: teamSkillTrackingCopy.tracked.error.generic },
      }));
      return;
    }

    setSkillTracking((prev) => ({ ...prev, [treeId]: { status: "untracked" } }));
    setSkillActions((prev) => ({ ...prev, [treeId]: { status: "idle" } }));
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

  const { team, members, invitations, requests, surveys, challenges, skillCatalog } = result;
  const activeSurveys = surveys.filter((entry) => !entry.archived);
  const archivedSurveys = surveys.filter((entry) => entry.archived);
  const challengeListState: AdminChallengeListState =
    challenges.status === "loaded"
      ? { status: "loaded", challenges: challenges.challenges }
      : { status: "error" };
  const skillCatalogState: TeamSkillCatalogState =
    skillCatalog.status === "loaded" ? { status: "loaded", trees: skillCatalog.trees } : { status: "error" };

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

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
          {surveysCopy.admin.sectionTitle}
        </h2>

        <form
          onSubmit={(event) => handleCreateSurvey(event, token, generation)}
          className="flex flex-col gap-3"
          aria-label={surveysCopy.admin.create.sectionTitle}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {surveysCopy.admin.create.accessModeLegend}
            </legend>
            <label className="flex items-start gap-2 text-sm text-zinc-900 dark:text-zinc-50">
              <input
                type="radio"
                name="survey-access-mode"
                value="public"
                checked={surveyAccessMode === "public"}
                onChange={() => setSurveyAccessMode("public")}
                className="mt-1"
              />
              <span>
                {surveysCopy.admin.accessModeLabels.public}
                <span className="block text-zinc-600 dark:text-zinc-400">
                  {surveysCopy.admin.create.accessModePublicHint}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-zinc-900 dark:text-zinc-50">
              <input
                type="radio"
                name="survey-access-mode"
                value="authenticated"
                checked={surveyAccessMode === "authenticated"}
                onChange={() => setSurveyAccessMode("authenticated")}
                className="mt-1"
              />
              <span>
                {surveysCopy.admin.accessModeLabels.authenticated}
                <span className="block text-zinc-600 dark:text-zinc-400">
                  {surveysCopy.admin.create.accessModeAuthenticatedHint}
                </span>
              </span>
            </label>
          </fieldset>

          <label
            htmlFor="admin-survey-title"
            className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
          >
            {surveysCopy.admin.create.titleLabel}
          </label>
          <input
            id="admin-survey-title"
            type="text"
            value={surveyTitle}
            onChange={(event) => setSurveyTitle(event.target.value)}
            className="rounded border border-zinc-300 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-900"
          />

          <label
            htmlFor="admin-survey-minimum-responses"
            className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
          >
            {surveysCopy.admin.create.minimumResponsesLabel}
          </label>
          <input
            id="admin-survey-minimum-responses"
            type="number"
            min={MINIMUM_RESPONSES_MIN}
            max={MINIMUM_RESPONSES_MAX}
            step={1}
            value={surveyMinimumResponses}
            onChange={(event) => setSurveyMinimumResponses(event.target.value)}
            className="w-24 rounded border border-zinc-300 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {surveysCopy.admin.create.minimumResponsesHint}
          </span>

          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="admin-survey-start-at"
                className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
              >
                {surveysCopy.admin.create.startAtLabel}
              </label>
              <input
                id="admin-survey-start-at"
                type="datetime-local"
                value={surveyStartAt}
                onChange={(event) => setSurveyStartAt(event.target.value)}
                className="rounded border border-zinc-300 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="admin-survey-end-at"
                className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
              >
                {surveysCopy.admin.create.endAtLabel}
              </label>
              <input
                id="admin-survey-end-at"
                type="datetime-local"
                value={surveyEndAt}
                onChange={(event) => setSurveyEndAt(event.target.value)}
                className="rounded border border-zinc-300 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
          </div>

          <div>
            <Button
              type="submit"
              disabled={surveyAccessMode === null}
              pending={surveyCreateState.status === "pending"}
            >
              {surveyCreateState.status === "pending"
                ? surveysCopy.admin.create.submitting
                : surveysCopy.admin.create.submit}
            </Button>
          </div>
          {surveyCreateState.status === "error" && (
            <Alert variant="error" className="text-sm">
              {surveyCreateState.message}
            </Alert>
          )}
        </form>

        {surveys.length === 0 ? (
          <EmptyState>{surveysCopy.admin.empty}</EmptyState>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {surveysCopy.admin.activeListTitle}
              </h3>
              {activeSurveys.length === 0 ? (
                <EmptyState>{surveysCopy.admin.empty}</EmptyState>
              ) : (
                <ul className="flex flex-col gap-3">
                  {activeSurveys.map((entry) => (
                    <SurveyRow
                      key={entry.surveyId}
                      entry={entry}
                      action={surveyActions[entry.surveyId] ?? { status: "idle" as const }}
                      isCopied={copiedSurveyId === entry.surveyId}
                      onOpen={() => handleOpenSurvey(token, generation, entry.surveyId)}
                      onClose={() => handleCloseSurvey(token, generation, entry.surveyId)}
                      onRequestRemove={() => handleRequestRemoveSurvey(entry.surveyId)}
                      onCancelRemove={() => handleCancelRemoveSurvey(entry.surveyId)}
                      onConfirmRemove={() => handleConfirmRemoveSurvey(token, generation, entry.surveyId)}
                      onCopyLink={() => handleCopySurveyLink(entry.surveyId)}
                    />
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {surveysCopy.admin.archivedListTitle}
              </h3>
              {archivedSurveys.length === 0 ? (
                <EmptyState>{surveysCopy.admin.noArchived}</EmptyState>
              ) : (
                <ul className="flex flex-col gap-3">
                  {archivedSurveys.map((entry) => (
                    <SurveyRow
                      key={entry.surveyId}
                      entry={entry}
                      action={surveyActions[entry.surveyId] ?? { status: "idle" as const }}
                      isCopied={copiedSurveyId === entry.surveyId}
                      onOpen={() => handleOpenSurvey(token, generation, entry.surveyId)}
                      onClose={() => handleCloseSurvey(token, generation, entry.surveyId)}
                      onRequestRemove={() => handleRequestRemoveSurvey(entry.surveyId)}
                      onCancelRemove={() => handleCancelRemoveSurvey(entry.surveyId)}
                      onConfirmRemove={() => handleConfirmRemoveSurvey(token, generation, entry.surveyId)}
                      onCopyLink={() => handleCopySurveyLink(entry.surveyId)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
          {challengesCopy.admin.sectionTitle}
        </h2>
        <AdminChallengeList
          state={challengeListState}
          actions={challengeActions}
          onResolve={(challengeId) => handleResolveChallenge(token, generation, challengeId)}
          onArchive={(challengeId) => handleArchiveChallenge(token, generation, challengeId)}
          onRequestDelete={handleRequestDeleteChallenge}
          onCancelDelete={handleCancelDeleteChallenge}
          onConfirmDelete={(challengeId) => handleConfirmDeleteChallenge(token, generation, challengeId)}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
          {teamSkillTrackingCopy.sectionTitle}
        </h2>
        <TeamSkillTrackingSection
          catalogState={skillCatalogState}
          tracking={skillTracking}
          actions={skillActions}
          teamDisabled={team.status === "disabled"}
          onStart={(treeId) => handleStartSkillTracking(token, generation, treeId)}
          onSetStage={(treeId, nodeId) => handleSetSkillStage(token, generation, treeId, nodeId)}
          onStop={(treeId) => handleStopSkillTracking(token, generation, treeId)}
        />
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

interface SurveyRowProps {
  entry: AdminSurveyEntry;
  action: SurveyRowActionState;
  isCopied: boolean;
  onOpen: () => void;
  onClose: () => void;
  onRequestRemove: () => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
  onCopyLink: () => void;
}

/**
 * One survey row for the admin survey-management section. Renders exactly
 * what `AdminTeamDetail`'s data (sourced from `listTeamSurveys`/
 * `createSurvey`/`openSurvey`/`closeSurvey`/`deleteOrArchiveSurvey`)
 * provides — it never computes lifecycle, access-mode eligibility, or any
 * authorization decision itself (`.claude/rules/security.md`).
 */
function SurveyRow({
  entry,
  action,
  isCopied,
  onOpen,
  onClose,
  onRequestRemove,
  onCancelRemove,
  onConfirmRemove,
  onCopyLink,
}: SurveyRowProps) {
  const isPending = action.status === "pending";
  const isConfirmingRemoval = action.status === "confirming_removal";
  const displayName = entry.title ?? surveysCopy.admin.fallbackTitle;

  return (
    <Card as="li" variant="bordered" padding="sm" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-medium text-zinc-900 dark:text-zinc-50">{displayName}</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {surveyLifecycleLabel(entry)}
            {entry.archived ? ` · ${surveysCopy.admin.archivedLabel}` : ""} ·{" "}
            {surveyAccessModeLabel(entry.accessMode)} ·{" "}
            {surveysCopy.admin.minimumResponsesSummary(entry.minimumResponses)}
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {surveysCopy.admin.linkLabel}{" "}
            <Link href={surveyLink(entry.surveyId)} className="underline">
              {surveyLink(entry.surveyId)}
            </Link>
          </p>
          {action.status === "error" && (
            <Alert variant="error" className="mt-1 text-sm">
              {action.message}
            </Alert>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${surveysCopy.admin.copyLinkButton} – ${displayName}`}
            onClick={onCopyLink}
          >
            {surveysCopy.admin.copyLinkButton}
          </Button>
          {isCopied && (
            <span role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
              {surveysCopy.admin.linkCopied}
            </span>
          )}
          {entry.lifecycle === "scheduled" && !entry.archived && (
            <Button
              variant="secondary"
              size="sm"
              pending={isPending}
              aria-label={`${isPending ? surveysCopy.admin.openingButton : surveysCopy.admin.openButton} – ${displayName}`}
              onClick={onOpen}
            >
              {isPending ? surveysCopy.admin.openingButton : surveysCopy.admin.openButton}
            </Button>
          )}
          {entry.lifecycle === "open" && (
            <Button
              variant="secondary"
              size="sm"
              pending={isPending}
              aria-label={`${isPending ? surveysCopy.admin.closingButton : surveysCopy.admin.closeButton} – ${displayName}`}
              onClick={onClose}
            >
              {isPending ? surveysCopy.admin.closingButton : surveysCopy.admin.closeButton}
            </Button>
          )}
          {entry.lifecycle === "closed" && !entry.archived && !isConfirmingRemoval && (
            <Button
              variant="destructive"
              size="sm"
              pending={isPending}
              aria-label={`${isPending ? surveysCopy.admin.removingButton : surveysCopy.admin.removeButton} – ${displayName}`}
              onClick={onRequestRemove}
            >
              {isPending ? surveysCopy.admin.removingButton : surveysCopy.admin.removeButton}
            </Button>
          )}
        </div>
      </div>
      {isConfirmingRemoval && (
        <div className="flex flex-col gap-2 rounded border border-red-300 p-3 dark:border-red-900">
          <p className="text-sm text-zinc-900 dark:text-zinc-50">{surveysCopy.admin.removeConfirmPrompt}</p>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              aria-label={`${surveysCopy.admin.removeConfirmButton} – ${displayName}`}
              onClick={onConfirmRemove}
            >
              {surveysCopy.admin.removeConfirmButton}
            </Button>
            <Button variant="secondary" size="sm" onClick={onCancelRemove}>
              {surveysCopy.admin.removeCancelButton}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

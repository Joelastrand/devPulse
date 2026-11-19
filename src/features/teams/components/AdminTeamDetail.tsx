"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Icon } from "../../../components/ui/Icon";
import { Plus } from "lucide-react";
import { AdminSurveyList, surveyLink, type SurveyRowActionState } from "./AdminSurveyList";
import { AdminTeamDetailSkeleton } from "./TeamAdminSkeletons";
import { PageHeader } from "../../../components/ui/PageHeader";
import { ADMIN_SCOPE_EYEBROW } from "../../../components/ui/copy";
import { TextField } from "../../../components/ui/TextField";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { TeamVisibilitySettings } from "./TeamVisibilitySettings";
import { AdminTeamTabPanel, AdminTeamTabs } from "./AdminTeamTabs";
import { AdminTeamOverview, type AdminTeamOverviewCounts } from "./AdminTeamOverview";
import { TeamMembersPanel, type MemberActionState } from "./TeamMembersPanel";
import {
  TeamInvitationsPanel,
  type InviteFormState,
  type RequestActionState,
  type RowActionState,
} from "./TeamInvitationsPanel";
import { MemberRoleAssignments } from "../../role-profiles/components/MemberRoleAssignments";
import { roleAssignmentCopy } from "../../role-profiles/copy";
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
  prepareAdminMemberRefs,
  removeAdminTeamMember,
  resolveAccessRequest,
  setAdminTeamMemberRole,
  type AdminPendingAccessRequestEntry,
  type AdminPendingInvitationEntry,
  type AdminTeamMemberEntry,
  type PrepareAdminMemberRefsError,
  type SetAdminTeamMemberRoleError,
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
 * it (docs/archive/features/anonymous-challenges/SPEC.md — TASK-006: a challenge
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
 * independently of the rest of the page (docs/archive/features/team-skill-tree/
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
 * TASK-006/TASK-007 admin-reload finding — docs/archive/features/team-skill-tree/
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


/** The member-ref preparation action's own state (one team-wide action, not per row). */
type PrepareMemberRefsState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; truncated: boolean }
  | { status: "error"; message: string };

type SurveyCreateState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "error"; message: string };

/**
 * The survey-link "copy" affordance's own transient feedback state
 * (docs/archive/features/ui-refresh/SPEC.md — BR-22): a successful copy and a
 * failed one (e.g. a denied clipboard permission) share the same
 * transient-then-cleared mechanism, keyed to one survey row at a time —
 * only which outcome to render differs.
 */
type SurveyLinkCopyState = { surveyId: string; status: "success" | "failure" };

/**
 * Approve and Reject share one guard per request (only one of the two may
 * be in flight at a time — an approve and a reject for the same request
 * must never both fire), but the UI still needs to know *which* of the two
 * is pending so only the clicked button shows a pending label; the other
 * is merely disabled, never mislabeled as busy.
 */
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

function memberRoleErrorMessage(error: SetAdminTeamMemberRoleError): string {
  if (error === "team_disabled") return adminCopy.detail.roleError.teamDisabled;
  if (error === "not_a_member") return adminCopy.detail.roleError.notAMember;
  return adminCopy.detail.rowError;
}

function prepareMemberRefsErrorMessage(error: PrepareAdminMemberRefsError): string {
  if (error === "team_not_found") return adminCopy.detail.prepareMemberRefsError.teamNotFound;
  return adminCopy.detail.prepareMemberRefsError.generic;
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


/**
 * Admin-only `/admin/teams/[teamId]` detail page
 * (docs/archive/features/team-management/SPEC.md — BR-17, BR-19, BR-21, BR-26,
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
  const [inviteState, setInviteState] = useState<InviteFormState>({ status: "idle" });
  const [email, setEmail] = useState("");
  const [memberActions, setMemberActions] = useState<Record<string, MemberActionState>>({});
  const [invitationActions, setInvitationActions] = useState<Record<string, RowActionState>>({});
  const [requestActions, setRequestActions] = useState<Record<string, RequestActionState>>({});
  const [prepareState, setPrepareState] = useState<PrepareMemberRefsState>({ status: "idle" });
  const [surveyFormOpen, setSurveyFormOpen] = useState(false);
  const [surveyCreateState, setSurveyCreateState] = useState<SurveyCreateState>({ status: "idle" });
  const [surveyAccessMode, setSurveyAccessMode] = useState<SurveyAccessMode | null>(null);
  const [surveyTitle, setSurveyTitle] = useState("");
  const [surveyMinimumResponses, setSurveyMinimumResponses] = useState(
    String(DEFAULT_MINIMUM_RESPONSES),
  );
  const [surveyStartAt, setSurveyStartAt] = useState("");
  const [surveyEndAt, setSurveyEndAt] = useState("");
  const [surveyActions, setSurveyActions] = useState<Record<string, SurveyRowActionState>>({});
  const [surveyLinkCopyState, setSurveyLinkCopyState] = useState<SurveyLinkCopyState | null>(null);
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
      setPrepareState({ status: "idle" });
      setSurveyFormOpen(false);
      setSurveyCreateState({ status: "idle" });
      setSurveyAccessMode(null);
      setSurveyTitle("");
      setSurveyStartAt("");
      setSurveyEndAt("");
      setSurveyActions({});
      setSurveyLinkCopyState(null);
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

    // `saved` is set only here, after the server confirmed the invitation.
    setInviteState({ status: "saved" });
    setEmail("");
    await loadForGeneration(token, generation);
  }

  /** Opens the inline removal confirmation. Nothing is sent to the server until the admin confirms. */
  function handleRequestRemoveMember(uid: string) {
    setMemberActions((prev) => ({ ...prev, [uid]: { status: "confirming_removal" } }));
  }

  function handleCancelRemoveMember(uid: string) {
    setMemberActions((prev) => ({ ...prev, [uid]: { status: "idle" } }));
  }

  async function handleRemoveMember(token: string, generation: number, uid: string) {
    if (memberActions[uid]?.status === "pending") {
      return;
    }
    setMemberActions((prev) => ({ ...prev, [uid]: { status: "pending", kind: "remove" } }));

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

  /**
   * Promotes/demotes one member through the existing admin PATCH route, then
   * re-reads the authoritative member list (same pattern as removal). Each
   * member is administered independently — setting one lead never touches
   * another. The server remains the only authority (incl. rejecting a
   * promotion on a disabled team), so a stale view is safely refused.
   */
  async function handleSetMemberRole(token: string, generation: number, uid: string, role: "teamadmin" | "member") {
    if (memberActions[uid]?.status === "pending") {
      return;
    }
    setMemberActions((prev) => ({ ...prev, [uid]: { status: "pending", kind: "role" } }));

    const result = await setAdminTeamMemberRole(token, teamId, uid, role);

    if (!isCurrentGeneration(generation)) {
      return;
    }

    if (!result.ok) {
      setMemberActions((prev) => ({
        ...prev,
        [uid]: { status: "error", message: memberRoleErrorMessage(result.error) },
      }));
      return;
    }

    setMemberActions((prev) => ({ ...prev, [uid]: { status: "idle" } }));
    await loadForGeneration(token, generation);
  }

  /**
   * Runs the explicit admin member-ref preparation, then re-reads the member
   * list so the readiness state (`hasMemberRef`) is authoritative. One
   * team-wide action: a second click while pending is ignored.
   */
  async function handlePrepareMemberRefs(token: string, generation: number) {
    if (prepareState.status === "pending") {
      return;
    }
    setPrepareState({ status: "pending" });

    const result = await prepareAdminMemberRefs(token, teamId);

    if (!isCurrentGeneration(generation)) {
      return;
    }

    if (!result.ok) {
      setPrepareState({ status: "error", message: prepareMemberRefsErrorMessage(result.error) });
      return;
    }

    setPrepareState({ status: "success", truncated: result.truncated });
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
      // min/max attributes (docs/archive/features/managed-surveys/SPEC.md —
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
    setSurveyFormOpen(false);
    await loadForGeneration(token, generation);
  }

  /**
   * Closes the survey-creation form without creating anything
   * (docs/archive/features/ui-refresh/SPEC.md — BR-14), resetting the same
   * in-progress fields a successful create already resets — no
   * already-submitted server state (there is none yet) is ever discarded.
   */
  function handleCancelCreateSurvey() {
    setSurveyFormOpen(false);
    setSurveyAccessMode(null);
    setSurveyTitle("");
    setSurveyMinimumResponses(String(DEFAULT_MINIMUM_RESPONSES));
    setSurveyStartAt("");
    setSurveyEndAt("");
    setSurveyCreateState({ status: "idle" });
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
      // Never exposes the underlying clipboard-API error detail — only a
      // generic, non-sensitive failure indication (BR-22).
      setSurveyLinkCopyState({ surveyId, status: "failure" });
      setTimeout(
        () =>
          setSurveyLinkCopyState((current) =>
            current?.surveyId === surveyId && current.status === "failure" ? null : current,
          ),
        2000,
      );
      return;
    }
    setSurveyLinkCopyState({ surveyId, status: "success" });
    setTimeout(
      () =>
        setSurveyLinkCopyState((current) =>
          current?.surveyId === surveyId && current.status === "success" ? null : current,
        ),
      2000,
    );
  }

  /**
   * Resolve/archive/delete each guard against a duplicate click for their
   * own row only (`challengeActions[challengeId]`) — resolving one
   * challenge never disables, shows pending, or overwrites the error state
   * of another (docs/archive/features/anonymous-challenges/SPEC.md — TASK-006,
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
   * TASK-006's start/set-stage/stop handlers (docs/archive/features/team-skill-tree/
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
    return <AdminTeamDetailSkeleton label={adminCopy.detail.loading} />;
  }

  if (state.phase === "signed_out") {
    return <SignInPrompt />;
  }

  const { result, token, generation } = state;

  if (result.status === "unauthenticated") {
    return <SignInPrompt />;
  }

  if (result.status === "forbidden") {
    // Deliberately generic — never confirms or denies whether the caller is
    // an active superadmin in the registry.
    return <Alert variant="error">{adminCopy.detail.forbidden}</Alert>;
  }

  if (result.status === "read_failed") {
    return <Alert variant="error">{adminCopy.detail.error}</Alert>;
  }

  if (result.status === "not_found") {
    return <Alert variant="error">{adminCopy.detail.notFound}</Alert>;
  }

  const { team, members, invitations, requests, surveys, challenges, skillCatalog } = result;
  const challengeListState: AdminChallengeListState =
    challenges.status === "loaded"
      ? { status: "loaded", challenges: challenges.challenges }
      : { status: "error" };
  const skillCatalogState: TeamSkillCatalogState =
    skillCatalog.status === "loaded" ? { status: "loaded", trees: skillCatalog.trees } : { status: "error" };

  const overviewCounts: AdminTeamOverviewCounts = {
    members: members.length,
    invitations: invitations.length,
    requests: requests.length,
    surveys: surveys.length,
    challenges: challenges.status === "loaded" ? challenges.challenges.length : null,
  };
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={ADMIN_SCOPE_EYEBROW}
        title={team.name}
        description={`${team.status === "active" ? adminCopy.teams.statusActive : adminCopy.teams.statusDisabled} · ${adminCopy.teams.teamIdLabel} ${team.teamId}`}
      />
      <AdminTeamTabs label={adminCopy.detail.tabsLabel}>
      <AdminTeamTabPanel id="oversikt" label={adminCopy.detail.tabs.oversikt}>
          <AdminTeamOverview counts={overviewCounts} />
        <TeamVisibilitySettings key={`visibility:${generation}`} teamId={teamId} token={token} />
      </AdminTeamTabPanel>
      <AdminTeamTabPanel id="medlemmer" label={adminCopy.detail.tabs.medlemmer}>
        <TeamMembersPanel
          key={`members:${generation}`}
          teamId={teamId}
          teamDisabled={team.status === "disabled"}
          members={members}
          memberActions={memberActions}
          onSetRole={(uid, role) => handleSetMemberRole(token, generation, uid, role)}
          onRequestRemoval={handleRequestRemoveMember}
          onCancelRemoval={handleCancelRemoveMember}
          onConfirmRemoval={(uid) => handleRemoveMember(token, generation, uid)}
          notices={
            <>
          {members.some((member) => !member.hasMemberRef) && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{adminCopy.detail.prepareMemberRefsHint}</p>
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  pending={prepareState.status === "pending"}
                  onClick={() => handlePrepareMemberRefs(token, generation)}
                >
                  {prepareState.status === "pending"
                    ? adminCopy.detail.preparingMemberRefsButton
                    : adminCopy.detail.prepareMemberRefsButton}
                </Button>
              </div>
            </div>
          )}
          {prepareState.status === "error" && <Alert variant="error">{prepareState.message}</Alert>}
          {prepareState.status === "success" && (
            <Alert variant="success">
              {prepareState.truncated
                ? `${adminCopy.detail.prepareMemberRefsSuccess} ${adminCopy.detail.prepareMemberRefsTruncated}`
                : adminCopy.detail.prepareMemberRefsSuccess}
            </Alert>
          )}
            </>
          }
        />
      </AdminTeamTabPanel>
      <AdminTeamTabPanel id="roller" label={adminCopy.detail.tabs.roller}>
        {/* Formal organizational role per member (role-profiles SPEC, "Formal role assignment"). Admin-only, one role per user. */}
        <section id="admin-section-roles" aria-labelledby="admin-section-roles-heading" className="flex flex-col gap-4">
          <div>
            <h2 id="admin-section-roles-heading" className="text-lg font-semibold text-text-primary">
              {roleAssignmentCopy.sectionTitle}
            </h2>
            <p className="mt-1 text-sm text-text-secondary">{roleAssignmentCopy.sectionDescription}</p>
            <p className="mt-1 text-sm text-text-muted">{roleAssignmentCopy.accessNote}</p>
          </div>
          {/* Keyed by account generation, so a switch discards open editors and any search text. */}
          <MemberRoleAssignments key={`roles:${generation}`} token={token} members={members} />
        </section>
      </AdminTeamTabPanel>
      <AdminTeamTabPanel id="invitasjoner" label={adminCopy.detail.tabs.invitasjoner}>
        <TeamInvitationsPanel
          email={email}
          onEmailChange={setEmail}
          inviteState={inviteState}
          onInvite={(event) => handleInvite(event, token, generation)}
          invitations={invitations}
          invitationActions={invitationActions}
          onCancelInvitation={(invitationEmail) => handleCancelInvitation(token, generation, invitationEmail)}
          requests={requests}
          requestActions={requestActions}
          onResolveRequest={(uid, status) => handleResolveRequest(token, generation, uid, status)}
        />
      </AdminTeamTabPanel>
      <AdminTeamTabPanel id="undersokelser" label={adminCopy.detail.tabs.undersokelser}>
        <section id="admin-section-surveys" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-text-primary">{surveysCopy.admin.sectionTitle}</h2>
              <p className="mt-1 text-sm text-text-secondary">{surveysCopy.admin.sectionDescription}</p>
            </div>
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="inline-flex shrink-0 items-center gap-2"
              aria-expanded={surveyFormOpen}
              aria-controls="admin-survey-create-form"
              onClick={() => setSurveyFormOpen((prev) => !prev)}
            >
              <Icon icon={Plus} size="inline" />
              {surveysCopy.admin.create.toggleButton}
            </Button>
          </div>

          {surveyFormOpen && (
            <form
              id="admin-survey-create-form"
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

              <TextField
                id="admin-survey-title"
                label={surveysCopy.admin.create.titleLabel}
                type="text"
                value={surveyTitle}
                onChange={(event) => setSurveyTitle(event.target.value)}
                aria-invalid={surveyCreateState.status === "error" || undefined}
                aria-describedby={surveyCreateState.status === "error" ? "admin-survey-create-error" : undefined}
              />

              <TextField
                id="admin-survey-minimum-responses"
                label={surveysCopy.admin.create.minimumResponsesLabel}
                type="number"
                min={MINIMUM_RESPONSES_MIN}
                max={MINIMUM_RESPONSES_MAX}
                step={1}
                value={surveyMinimumResponses}
                onChange={(event) => setSurveyMinimumResponses(event.target.value)}
                description={surveysCopy.admin.create.minimumResponsesHint}
                className="w-24"
                aria-invalid={surveyCreateState.status === "error" || undefined}
                aria-describedby={
                  surveyCreateState.status === "error"
                    ? "admin-survey-minimum-responses-description admin-survey-create-error"
                    : "admin-survey-minimum-responses-description"
                }
              />

              <div className="flex flex-wrap gap-4">
                <TextField
                  id="admin-survey-start-at"
                  label={surveysCopy.admin.create.startAtLabel}
                  type="datetime-local"
                  value={surveyStartAt}
                  onChange={(event) => setSurveyStartAt(event.target.value)}
                  aria-invalid={surveyCreateState.status === "error" || undefined}
                  aria-describedby={surveyCreateState.status === "error" ? "admin-survey-create-error" : undefined}
                />
                <TextField
                  id="admin-survey-end-at"
                  label={surveysCopy.admin.create.endAtLabel}
                  type="datetime-local"
                  value={surveyEndAt}
                  onChange={(event) => setSurveyEndAt(event.target.value)}
                  aria-invalid={surveyCreateState.status === "error" || undefined}
                  aria-describedby={surveyCreateState.status === "error" ? "admin-survey-create-error" : undefined}
                />
              </div>

              <div className="flex gap-2">
                <Button
                  type="submit"
                  disabled={surveyAccessMode === null}
                  pending={surveyCreateState.status === "pending"}
                >
                  {surveyCreateState.status === "pending"
                    ? surveysCopy.admin.create.submitting
                    : surveysCopy.admin.create.submit}
                </Button>
                <Button type="button" variant="secondary" onClick={handleCancelCreateSurvey}>
                  {surveysCopy.admin.create.cancelButton}
                </Button>
              </div>
              {surveyCreateState.status === "error" && (
                <Alert variant="error" id="admin-survey-create-error" className="text-sm">
                  {surveyCreateState.message}
                </Alert>
              )}
            </form>
          )}

          <AdminSurveyList
            key={`surveys:${generation}`}
            entries={surveys}
            actions={surveyActions}
            copyStateFor={(surveyId) =>
              surveyLinkCopyState?.surveyId === surveyId ? surveyLinkCopyState.status : "idle"
            }
            onOpen={(surveyId) => handleOpenSurvey(token, generation, surveyId)}
            onClose={(surveyId) => handleCloseSurvey(token, generation, surveyId)}
            onRequestRemove={handleRequestRemoveSurvey}
            onCancelRemove={handleCancelRemoveSurvey}
            onConfirmRemove={(surveyId) => handleConfirmRemoveSurvey(token, generation, surveyId)}
            onCopyLink={handleCopySurveyLink}
          />
        </section>
      </AdminTeamTabPanel>
      <AdminTeamTabPanel id="utfordringer" label={adminCopy.detail.tabs.utfordringer}>
        <section id="admin-section-challenges" className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">{challengesCopy.admin.sectionTitle}</h2>
            <p className="mt-1 text-sm text-text-secondary">{challengesCopy.admin.sectionDescription}</p>
          </div>
          {/* Keyed by account generation, so a switch discards the previous account's search and filter. */}
          <AdminChallengeList
            key={`challenges:${generation}`}
            state={challengeListState}
            actions={challengeActions}
            onResolve={(challengeId) => handleResolveChallenge(token, generation, challengeId)}
            onArchive={(challengeId) => handleArchiveChallenge(token, generation, challengeId)}
            onRequestDelete={handleRequestDeleteChallenge}
            onCancelDelete={handleCancelDeleteChallenge}
            onConfirmDelete={(challengeId) => handleConfirmDeleteChallenge(token, generation, challengeId)}
          />
        </section>
      </AdminTeamTabPanel>
      <AdminTeamTabPanel id="kompetanse" label={adminCopy.detail.tabs.kompetanse}>
        <section id="admin-section-skills" className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">{teamSkillTrackingCopy.sectionTitle}</h2>
            <p className="mt-1 text-sm text-text-secondary">{teamSkillTrackingCopy.sectionDescription}</p>
          </div>
          {/* Keyed by account generation, so a switch discards the previous account's tracking view and search text. */}
          <TeamSkillTrackingSection
            key={`skills:${generation}`}
            catalogState={skillCatalogState}
            tracking={skillTracking}
            actions={skillActions}
            teamDisabled={team.status === "disabled"}
            onStart={(treeId) => handleStartSkillTracking(token, generation, treeId)}
            onSetStage={(treeId, nodeId) => handleSetSkillStage(token, generation, treeId, nodeId)}
            onStop={(treeId) => handleStopSkillTracking(token, generation, treeId)}
          />
        </section>
      </AdminTeamTabPanel>
      </AdminTeamTabs>
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

"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button, buttonClassName } from "../../../components/ui/Button";
import { PageHeader } from "../../../components/ui/PageHeader";
import { LoadingState } from "../../../components/ui/LoadingState";
import { useAnnounceTeamName } from "../../../components/nav/TeamContext";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import {
  fetchTeamChallenges,
  type FetchTeamChallengesResult,
} from "../../challenges/client/challenges-gateway";
import { ChallengeSubmissionDialog } from "../../challenges/components/ChallengeSubmissionDialog";
import { fetchTeamResults } from "../../results/client/team-results-gateway";
import { fetchTeamSkills, type FetchTeamSkillsResult, type TeamSkillView } from "../../skill-trees/client/skill-trees-gateway";
import { teamsCopy } from "../copy";
import { fetchTeamsOverview, requestTeamAccess } from "../client/teams-overview-gateway";
import { requestAccessErrorMessage } from "./request-access-messages";
import { TeamPageHeader } from "./TeamPageHeader";
import { TeamOversiktSummary } from "./TeamOversiktSummary";
import { TeamOversiktChallenges, type OversiktChallengesState } from "./TeamOversiktChallenges";
import { TeamHeaderMetrics } from "./TeamHeaderMetrics";

type DeniedRelationship = "none" | "request_pending" | "request_rejected";

/**
 * Composed states for the overview's two independently-read sections. A failed read is `"unavailable"`, never a
 * fabricated empty list or zero count (every section fails independently).
 */
type ChallengesSectionState = OversiktChallengesState;

function toChallengesSectionState(result: FetchTeamChallengesResult): ChallengesSectionState {
  return result.status === "ok"
    ? { status: "loaded", challenges: result.challenges, canSubmit: result.canSubmit }
    : { status: "unavailable" };
}

type SkillSectionState =
  | { status: "loaded"; skills: TeamSkillView[] }
  | { status: "unavailable" };

function toSkillSectionState(result: FetchTeamSkillsResult): SkillSectionState {
  return result.status === "ok" ? { status: "loaded", skills: result.skills } : { status: "unavailable" };
}

/**
 * The composed result this component renders — never a raw gateway response. Only `authorized` and
 * `results_unavailable` ever carry team data; every other state is a non-sensitive "you don't have access" variant
 * (docs/archive/features/team-management/SPEC.md — BR-14, BR-15, BR-16).
 */
type TeamDetailResult =
  | { status: "unauthenticated" }
  | { status: "read_failed" }
  | { status: "denied"; name?: string; relationship: DeniedRelationship }
  | { status: "results_unavailable"; name?: string; challenges: ChallengesSectionState; skills: SkillSectionState }
  | { status: "authorized"; name?: string; challenges: ChallengesSectionState; skills: SkillSectionState };

/**
 * Loads one team's detail: the caller's relationship to `teamId` (via the existing `/teams` overview) and, unless the
 * overview already reports a known negative relationship, the authoritative results endpoint.
 *
 * The overview relationship is used only to *skip* an unnecessary request for a caller the trusted backend already
 * reports as non-member/pending/rejected — it is never itself treated as the authorization decision. An **absent**
 * overview entry is ambiguous, not a known denial (a disabled team an app admin holds no membership document for is
 * absent from the overview), so the results endpoint — the only `authorizeTeamAccess`-backed decision — is always asked
 * before anything is rendered as denied (review-change TASK-008 finding, BR-3/BR-14).
 */
async function loadTeamDetail(idToken: string, teamId: string): Promise<TeamDetailResult> {
  const overview = await fetchTeamsOverview(idToken);
  if (overview.status === "unauthenticated") {
    return { status: "unauthenticated" };
  }
  if (overview.status !== "ok") {
    return { status: "read_failed" };
  }

  const entry = overview.teams.find((team) => team.teamId === teamId);

  if (
    entry &&
    (entry.relationship === "none" ||
      entry.relationship === "request_pending" ||
      entry.relationship === "request_rejected")
  ) {
    return { status: "denied", name: entry.name, relationship: entry.relationship };
  }

  return resolveViaResults(idToken, teamId, entry?.name);
}

async function resolveViaResults(idToken: string, teamId: string, name: string | undefined): Promise<TeamDetailResult> {
  // Results is the authorization decision; challenges and skills feed the overview's own counts and card. All three are
  // separate, independently-authorized server contracts, so none waits on another.
  const [results, challengesResult, skillsResult] = await Promise.all([
    fetchTeamResults(idToken, teamId),
    fetchTeamChallenges(idToken, teamId),
    fetchTeamSkills(idToken, teamId),
  ]);

  if (results.status === "ok") {
    return {
      status: "authorized",
      name,
      challenges: toChallengesSectionState(challengesResult),
      skills: toSkillSectionState(skillsResult),
    };
  }
  if (results.status === "unauthenticated") {
    return { status: "unauthenticated" };
  }
  if (results.status === "forbidden") {
    // Covers a member whose membership was revoked after the overview read (fail closed rather than trusting the stale
    // relationship) and the ambiguous no-entry case turning out to be a genuine denial. Rendered identically either way
    // (BR-16). The parallel challenge and skill results are discarded: a denied caller never sees them.
    return { status: "denied", name, relationship: "none" };
  }
  return {
    status: "results_unavailable",
    name,
    challenges: toChallengesSectionState(challengesResult),
    skills: toSkillSectionState(skillsResult),
  };
}

type ViewState =
  | { phase: "loading" }
  | { phase: "signed_out" }
  | { phase: "loaded"; token: string; generation: number; result: TeamDetailResult };

type RequestActionState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "error"; message: string };

const RELATIONSHIP_MESSAGES: Record<DeniedRelationship, string> = teamsCopy.detail.relationshipMessages;

/**
 * Authenticated `/teams/[teamId]` overview (docs/archive/features/team-management/SPEC.md — BR-12, BR-14 through BR-16;
 * reference 18). Renders the team header and the overview only. Detailed workflows (roadmap, competence plan, skill
 * tracking, needs, roster, visibility, results history) live on their own team sub-pages.
 *
 * Mirrors `TeamsOverview`'s client-side auth-state and generation-guard pattern via `useAuthGatedResource`, extended to
 * reset on a route change: `teamId` is a reset dependency, so a slow response for one team can never render on another.
 */
export function TeamDetail({ teamId }: { teamId: string }) {
  const [state, setState] = useState<ViewState>({ phase: "loading" });
  const [actionState, setActionState] = useState<RequestActionState>({ status: "idle" });

  const { isCurrentGeneration } = useAuthGatedResource(
    (token, generation) => {
      setActionState({ status: "idle" });

      if (!token) {
        setState({ phase: "signed_out" });
        return;
      }

      setState({ phase: "loading" });
      loadForGeneration(token, generation);
    },
    [teamId],
  );

  async function loadForGeneration(token: string, generation: number) {
    const result = await loadTeamDetail(token, teamId);
    if (isCurrentGeneration(generation)) {
      setState({ phase: "loaded", token, generation, result });
    }
  }

  /**
   * Re-reads only the challenge section after a successful submission, so the list and the "Åpne utfordringer" count
   * update without re-running the overview, results and skills reads. Applies only to the same generation and only
   * while an authorized view is on screen, so a late response never repaints a different team or a denied view.
   */
  async function refreshChallenges(token: string, generation: number) {
    const challenges = toChallengesSectionState(await fetchTeamChallenges(token, teamId));
    if (!isCurrentGeneration(generation)) {
      return;
    }
    setState((current) =>
      current.phase === "loaded" &&
      current.generation === generation &&
      (current.result.status === "authorized" || current.result.status === "results_unavailable")
        ? { ...current, result: { ...current.result, challenges } }
        : current,
    );
  }

  async function handleRequestAccess(token: string, generation: number) {
    setActionState({ status: "pending" });

    const result = await requestTeamAccess(token, teamId);

    if (!isCurrentGeneration(generation)) {
      return;
    }

    if (!result.ok) {
      setActionState({ status: "error", message: requestAccessErrorMessage(result.error) });
      return;
    }

    setActionState({ status: "idle" });
    await loadForGeneration(token, generation);
  }

  if (state.phase === "loading") {
    return <LoadingState label={teamsCopy.detail.loading} />;
  }

  if (state.phase === "signed_out") {
    return <SignInPrompt />;
  }

  const { result, token, generation } = state;

  if (result.status === "unauthenticated") {
    return <SignInPrompt />;
  }

  if (result.status === "read_failed") {
    return <Alert variant="error">{teamsCopy.detail.error}</Alert>;
  }

  if (result.status === "authorized" || result.status === "results_unavailable") {
    const competenceAreas = result.skills.status === "loaded" ? result.skills.skills.length : null;
    return (
      <div className="flex flex-col gap-6">
        <TeamHeading name={result.name} teamId={teamId}>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <TeamHeaderMetrics key={`metrics:${generation}`} teamId={teamId} token={token} competenceAreas={competenceAreas} />
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={`/teams/${encodeURIComponent(teamId)}/results`}
                className="text-label font-medium text-text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {teamsCopy.results.openLink}
              </Link>
              <Link
                href={`/teams/${encodeURIComponent(teamId)}/surveys`}
                className="text-label font-medium text-text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {teamsCopy.results.surveysLink}
              </Link>
              <Link href={`/teams/${encodeURIComponent(teamId)}/settings`} className={buttonClassName({ variant: "secondary", size: "sm" })}>
                {teamsCopy.detail.editTeam}
              </Link>
            </div>
          </div>
        </TeamHeading>
        {result.status === "results_unavailable" && <Alert variant="error">{teamsCopy.detail.resultsUnavailable}</Alert>}
        <TeamOversiktSummary
          teamId={teamId}
          token={token}
          openChallenges={result.challenges.status === "loaded" ? result.challenges.challenges.filter((c) => c.status === "open").length : null}
          challenges={
            <TeamOversiktChallenges
              state={result.challenges}
              action={
                result.challenges.status === "loaded" && result.challenges.canSubmit ? (
                  <ChallengeSubmissionDialog
                    idToken={token}
                    teamId={teamId}
                    onSubmitted={() => {
                      void refreshChallenges(token, generation);
                    }}
                  />
                ) : undefined
              }
            />
          }
        />
      </div>
    );
  }

  const canRequestAccess = result.relationship === "none" || result.relationship === "request_rejected";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={result.name ?? teamsCopy.detail.fallbackName} />
      <Alert variant="info">{RELATIONSHIP_MESSAGES[result.relationship]}</Alert>
      {actionState.status === "error" && <Alert variant="error">{actionState.message}</Alert>}
      {canRequestAccess && (
        <Button
          variant="secondary"
          size="sm"
          className="w-fit"
          pending={actionState.status === "pending"}
          onClick={() => handleRequestAccess(token, generation)}
        >
          {actionState.status === "pending" ? teamsCopy.requestingAccess : teamsCopy.requestAccess}
        </Button>
      )}
    </div>
  );
}

function TeamHeading({ name, teamId, children }: { name?: string; teamId: string; children?: ReactNode }) {
  // The shell shows the team name as context; the name is the one already loaded here.
  useAnnounceTeamName(name ?? null);
  return (
    <TeamPageHeader teamId={teamId} name={name ?? teamsCopy.detail.fallbackName}>
      {children}
    </TeamPageHeader>
  );
}

function SignInPrompt() {
  return (
    <p className="text-zinc-600 dark:text-zinc-400">
      <Link href="/sign-in" className="font-medium text-zinc-900 underline dark:text-zinc-50">
        {teamsCopy.detail.signInLink}
      </Link>{" "}
      {teamsCopy.detail.signInPrompt}
    </p>
  );
}

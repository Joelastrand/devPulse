"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { catchError } from "next/error";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import {
  fetchTeamChallenges,
  type FetchTeamChallengesResult,
  type MemberChallengeView,
} from "../../challenges/client/challenges-gateway";
import { ChallengeList, type ChallengeListState } from "../../challenges/components/ChallengeList";
import { ChallengeSubmissionPanel } from "../../challenges/components/ChallengeSubmissionPanel";
import { challengesCopy } from "../../challenges/copy";
import {
  fetchTeamThreads,
  type FetchTeamThreadsResult,
  type ThreadSummaryView,
} from "../../forum/client/forum-gateway";
import { CreateThreadForm } from "../../forum/components/CreateThreadForm";
import { ThreadList, type ThreadListState } from "../../forum/components/ThreadList";
import { forumCopy } from "../../forum/copy";
import {
  fetchTeamResults,
  type SurveyResultSummary,
} from "../../results/client/team-results-gateway";
import { RoadmapPlanningScope } from "../../roadmap/components/RoadmapPlanning";
import { fetchTeamSkills, type FetchTeamSkillsResult, type TeamSkillView } from "../../skill-trees/client/skill-trees-gateway";
import { TeamSkillSection, type TeamSkillSectionState } from "../../skill-trees/components/TeamSkillSection";
import { PeriodSummary } from "../../results/components/PeriodSummary";
import { TrendTable } from "../../results/components/TrendTable";
import { formatSurveyDate } from "../../results/domain/format-survey-date";
import { resultsCopy } from "../../results/copy";
import {
  fetchCurrentTeamSurvey,
  type CurrentTeamSurveySummary,
  type FetchCurrentTeamSurveyResult,
} from "../../surveys/client/current-team-survey-gateway";
import { surveysCopy } from "../../surveys/copy";
import { teamsCopy } from "../copy";
import {
  fetchTeamsOverview,
  requestTeamAccess,
} from "../client/teams-overview-gateway";
import { requestAccessErrorMessage } from "./request-access-messages";
import { TeamSkillNeedsSection } from "../../team-skills/components/TeamSkillNeedsSection";
import { TeamRosterSection } from "./TeamRosterSection";
import { TeamRouteNav } from "./TeamRouteNav";

/**
 * `TrendChart` code-split out of this page's eager client bundle
 * (docs/features/performance-phase-a/SPEC.md — TASK-003, AD-3/AD-5):
 * `recharts` (its single largest dependency) only enters the client bundle
 * once this lazy component actually renders, never merely because
 * `TeamDetail` mounts. `ssr: false` because `TeamDetail` is already a Client
 * Component with no server-rendered data for this content to begin with.
 * Declared at module scope (never inside the component body) — required for
 * Next.js's webpack bundle matching/preloading, mirroring `next/dynamic`'s
 * own `React.lazy()` requirement.
 */
const LazyTrendChart = dynamic<{ results: readonly SurveyResultSummary[] }>(
  () => import("../../results/components/TrendChart").then((mod) => mod.TrendChart),
  {
    ssr: false,
    loading: () => <LoadingState label={resultsCopy.trendChart.loading} />,
  },
);

/**
 * The chart-local error-boundary fallback (SPEC → AD-6): minimal, static,
 * non-interactive, and containing no data fetching, auth, or product logic
 * of its own — exactly what AD-6 constrains it to. Never renders
 * `errorInfo.error`'s message (no sensitive/internal exception detail is
 * ever shown to the user).
 */
function TrendChartFallback() {
  return <Alert variant="error">{resultsCopy.trendChart.loadError}</Alert>;
}

/**
 * Wraps only the dynamically-imported `TrendChart` region in an error
 * boundary via Next.js's first-party `catchError` (`next/error`, stable
 * since Next.js 16.3.0, callable from Client Components — verified against
 * this repository's installed `next@16.3.4` types/docs) — SPEC → AD-6. A
 * chunk-load failure or a render-time exception in `LazyTrendChart` is
 * caught here and isolated to this region only; every sibling section on
 * `/teams/[teamId]` is unaffected (BR-18).
 */
const TrendChartBoundary = catchError(TrendChartFallback);

type DeniedRelationship = "none" | "request_pending" | "request_rejected";

/**
 * The "Pågående undersøkelse" section's own composed state, resolved
 * independently of the results read above it (docs/features/
 * managed-surveys/SPEC.md — TASK-010: "Keep survey discovery and protected
 * results as separate server contracts"). `"unavailable"` covers both a
 * genuine read failure and the rare race where the parallel current-survey
 * read reports `forbidden`/`unauthenticated` even though the results read
 * just above it succeeded — never fabricated as "no current survey" in
 * either case (SPEC → "Error isolation").
 */
type CurrentSurveySectionState =
  | { status: "loaded"; survey: CurrentTeamSurveySummary | null }
  | { status: "unavailable" };

function toCurrentSurveySectionState(
  result: FetchCurrentTeamSurveyResult,
): CurrentSurveySectionState {
  return result.status === "ok"
    ? { status: "loaded", survey: result.survey }
    : { status: "unavailable" };
}

/**
 * The "Utfordringer" section's own composed state, resolved independently
 * of results/current-survey (docs/features/anonymous-challenges/SPEC.md —
 * TASK-005: a challenge-list read failure must not erase results/current
 * survey, and vice versa — every section fails independently). `"unavailable"`
 * covers both a genuine read failure and a rare authorization race, exactly
 * like `CurrentSurveySectionState` above — never fabricated as "no
 * challenges yet" in either case.
 *
 * `canSubmit` (debug fix — Challenge submission composition gap) carries
 * `listTeamChallengesForMember`'s own server-derived signal for whether
 * *this* caller holds a genuine current `teamMemberships` record, re-derived
 * independently of `authorizeTeamAccess`'s broader "admin"/"member" result —
 * an app-admin-only viewer (no real membership) gets `canSubmit: false` even
 * though they can still read this list. Only ever used to decide whether to
 * render the submission form; `submitChallenge`'s own server authorization
 * is unchanged and remains authoritative regardless of what this value is.
 */
type ChallengesSectionState =
  | { status: "loaded"; challenges: MemberChallengeView[]; canSubmit: boolean }
  | { status: "unavailable" };

function toChallengesSectionState(result: FetchTeamChallengesResult): ChallengesSectionState {
  return result.status === "ok"
    ? { status: "loaded", challenges: result.challenges, canSubmit: result.canSubmit }
    : { status: "unavailable" };
}

/**
 * The "Forum" section's own composed state, resolved independently of
 * results/current-survey/challenges (docs/features/team-forum/SPEC.md —
 * BR-45: a forum read failure must not erase any other section, and vice
 * versa — every section fails independently, mirroring
 * `ChallengesSectionState`'s identical established pattern).
 * `"unavailable"` covers both a genuine read failure and a rare
 * authorization race — never fabricated as "no threads yet" in either case.
 */
type ForumSectionState =
  | { status: "loaded"; threads: ThreadSummaryView[] }
  | { status: "unavailable" };

function toForumSectionState(result: FetchTeamThreadsResult): ForumSectionState {
  return result.status === "ok" ? { status: "loaded", threads: result.threads } : { status: "unavailable" };
}

/**
 * The "Kompetanseområder" section's own composed state, resolved
 * independently of results/current-survey/challenges/forum (docs/features/
 * team-skill-tree/SPEC.md — TASK-007, BR-28 through BR-30): a skill-list
 * read failure must not erase any other section, and vice versa (mirrors
 * `ChallengesSectionState`/`ForumSectionState`'s identical established
 * pattern). `"unavailable"` covers both a genuine read failure and a rare
 * authorization race — never fabricated as "no skills yet" in either case.
 */
type SkillSectionState =
  | { status: "loaded"; skills: TeamSkillView[]; canReportProgress: boolean }
  | { status: "unavailable" };

function toSkillSectionState(result: FetchTeamSkillsResult): SkillSectionState {
  return result.status === "ok"
    ? { status: "loaded", skills: result.skills, canReportProgress: result.canReportProgress }
    : { status: "unavailable" };
}

/** Adapts the already-resolved `SkillSectionState` to `TeamSkillSection`'s own state shape — "unavailable" always renders as "error", never a stale "loading" (the fetch has already completed by the time this component ever mounts). */
function toTeamSkillSectionState(state: SkillSectionState): TeamSkillSectionState {
  return state.status === "loaded"
    ? { status: "loaded", skills: state.skills, canReportProgress: state.canReportProgress }
    : { status: "error" };
}

/**
 * The composed result this component renders — never a raw gateway
 * response. Only `authorized` ever carries result/aggregate data; every
 * other state is a non-sensitive "you don't have access" variant
 * (docs/features/team-management/SPEC.md — BR-14, BR-15, BR-16). Both
 * `authorized` and `results_unavailable` also carry `challenges` — the
 * challenge section is shown to any authorized member/admin regardless of
 * whether the results read itself succeeded (docs/features/
 * anonymous-challenges/SPEC.md — BR-27); it is never fetched at all for a
 * denied/unauthenticated caller (see `loadTeamDetail`).
 */
type TeamDetailResult =
  | { status: "unauthenticated" }
  | { status: "read_failed" }
  | { status: "denied"; name?: string; relationship: DeniedRelationship }
  | {
      status: "results_unavailable";
      name?: string;
      currentSurvey: CurrentSurveySectionState;
      challenges: ChallengesSectionState;
      forum: ForumSectionState;
      skills: SkillSectionState;
    }
  | {
      status: "authorized";
      name?: string;
      results: SurveyResultSummary[];
      currentSurvey: CurrentSurveySectionState;
      challenges: ChallengesSectionState;
      forum: ForumSectionState;
      skills: SkillSectionState;
    };

/**
 * Loads one team's detail: the caller's relationship to `teamId` (via the
 * existing TASK-007 `/teams` overview, reused unchanged — no new metadata
 * endpoint is introduced) and, unless the overview already reports a known
 * negative relationship, that team's results (via the existing TASK-003
 * endpoint, reused unchanged).
 *
 * The overview relationship is used only to *skip* an unnecessary results
 * request for a caller the trusted backend already reports as
 * non-member/pending/rejected (BR-15's "never queried for a *denied*
 * caller", applied only to a *known* denial) — it is never itself treated
 * as the authorization decision. `"admin"`/`"member"` fetch results as
 * before. An **absent** overview entry is ambiguous, not a known denial: it
 * can mean a nonexistent team, a disabled team the caller has no
 * relationship to, *or* a disabled team an app admin holds no
 * `teamMemberships` document for — `getTeamsOverview` deliberately does not
 * enumerate every disabled team for an app admin (that full catalog is
 * TASK-009's job), so its absence alone must never be read as "denied" for
 * an actor `authorizeTeamAccess` would otherwise correctly authorize
 * (review-change TASK-008 finding, BR-3/BR-14). For that ambiguous case the
 * results endpoint — the only authoritative, `authorizeTeamAccess`-backed
 * decision — is always asked before anything is rendered as denied.
 */
async function loadTeamDetail(
  idToken: string,
  teamId: string,
  forumEnabled: boolean,
): Promise<TeamDetailResult> {
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

  // Either a known "admin"/"member" relationship, or no overview entry at
  // all (the ambiguous case) — both resolve via the authoritative results
  // endpoint, never via the overview alone.
  return resolveViaResults(idToken, teamId, entry?.name, forumEnabled);
}

async function resolveViaResults(
  idToken: string,
  teamId: string,
  name: string | undefined,
  forumEnabled: boolean,
): Promise<TeamDetailResult> {
  // Fetched in parallel — separate server contracts (results, current-survey
  // discovery, member-visible challenges, the forum thread list, and the
  // read-only skill-tracking list), each independently authorized, so no
  // read waits on another (docs/features/managed-surveys/SPEC.md —
  // TASK-010; docs/features/anonymous-challenges/SPEC.md — TASK-005;
  // docs/features/team-forum/SPEC.md — TASK-005, BR-45; docs/features/
  // team-skill-tree/SPEC.md — TASK-007).
  //
  // `fetchTeamThreads` is called only when the Forum UI feature flag is
  // enabled (docs/features/team-forum/SPEC.md — "Feature flag") — while
  // disabled, no Forum fetch is ever initiated by this component; the
  // placeholder result below is never rendered (`ForumSection` is not
  // rendered at all in that case — see the JSX below).
  const [results, surveyResult, challengesResult, forumResult, skillsResult] = await Promise.all([
    fetchTeamResults(idToken, teamId),
    fetchCurrentTeamSurvey(idToken, teamId),
    fetchTeamChallenges(idToken, teamId),
    forumEnabled
      ? fetchTeamThreads(idToken, teamId)
      : Promise.resolve<FetchTeamThreadsResult>({ status: "read_failed" }),
    fetchTeamSkills(idToken, teamId),
  ]);

  if (results.status === "ok") {
    return {
      status: "authorized",
      name,
      results: results.results,
      currentSurvey: toCurrentSurveySectionState(surveyResult),
      challenges: toChallengesSectionState(challengesResult),
      forum: toForumSectionState(forumResult),
      skills: toSkillSectionState(skillsResult),
    };
  }
  if (results.status === "unauthenticated") {
    return { status: "unauthenticated" };
  }
  if (results.status === "forbidden") {
    // Covers both: a known member/admin whose membership was revoked
    // between the overview read and this read (SPEC edge case: "removing a
    // member's teamMemberships document ... their next request is denied"
    // — fail closed rather than trusting the now-stale overview
    // relationship), and the ambiguous no-entry case turning out to be a
    // genuine denial. Rendered identically either way (BR-16) — no
    // distinguishing existence signal. The parallel current-survey,
    // challenges, forum, and skills results are discarded here regardless of
    // their own outcome: a denied caller never sees survey, challenge,
    // forum, or skill data.
    return { status: "denied", name, relationship: "none" };
  }
  return {
    status: "results_unavailable",
    name,
    currentSurvey: toCurrentSurveySectionState(surveyResult),
    challenges: toChallengesSectionState(challengesResult),
    forum: toForumSectionState(forumResult),
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

const RELATIONSHIP_MESSAGES: Record<DeniedRelationship, string> =
  teamsCopy.detail.relationshipMessages;

/**
 * Authenticated `/teams/[teamId]` detail page
 * (docs/features/team-management/SPEC.md — BR-12, BR-14 through BR-16).
 * Mirrors `TeamsOverview`'s client-side auth-state and generation-guard
 * pattern via the shared `useAuthGatedResource` hook, extended to also
 * guard against a *route* change: `teamId` is passed as an extra reset
 * dependency, so navigating from one team to another tears down the
 * previous subscription (bumping the generation, exactly like an auth
 * change) before starting a fresh load for the new team — a slow response
 * for team A can never render on team B's page, and Next.js route-instance
 * reuse is not relied on for this guarantee.
 */
export function TeamDetail({ teamId, forumEnabled }: { teamId: string; forumEnabled: boolean }) {
  const router = useRouter();
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

  /**
   * A hoisted function declaration (not `useCallback`) so it can be
   * referenced above, in the auth-change callback, without an
   * evaluation-order issue — it no longer needs to be memoized for an
   * effect's dependency array now that the subscription (and the `teamId`
   * route-change guard) lives inside `useAuthGatedResource`.
   */
  async function loadForGeneration(token: string, generation: number) {
    const result = await loadTeamDetail(token, teamId, forumEnabled);
    if (isCurrentGeneration(generation)) {
      setState({ phase: "loaded", token, generation, result });
    }
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

  /**
   * Refreshes only the challenge-list sub-state through the existing
   * `fetchTeamChallenges` server contract after a successful submission
   * (docs/features/anonymous-challenges/SPEC.md — TASK-005) — never
   * fabricates a challenge DTO client-side. Checked against the current
   * generation before applying, exactly like every other async continuation
   * in this component: a stale response belonging to a superseded auth
   * identity or a since-navigated-away `teamId` must never populate the
   * current page. Results/current-survey sub-state is left untouched.
   */
  async function handleChallengeSubmitted(token: string, generation: number) {
    const refreshed = await fetchTeamChallenges(token, teamId);
    if (!isCurrentGeneration(generation)) {
      return;
    }

    setState((previous) => {
      if (previous.phase !== "loaded" || !isCurrentGeneration(generation)) {
        return previous;
      }
      const { result } = previous;
      if (result.status !== "authorized" && result.status !== "results_unavailable") {
        return previous;
      }
      return {
        ...previous,
        result: { ...result, challenges: toChallengesSectionState(refreshed) },
      };
    });
  }

  /**
   * Refreshes only the skill-tracking sub-state through the existing
   * `fetchTeamSkills` (→ `getTeamSkillProgress`) server contract after a
   * successful self-report (docs/features/skill-progress-self-report/
   * SPEC.md — TASK-002, "No optimistic local update") — mirrors
   * `handleChallengeSubmitted`'s identical established pattern. Never
   * fabricates a `TeamSkillView` client-side; a stale response belonging to
   * a superseded auth identity or a since-navigated-away `teamId` must
   * never populate the current page.
   */
  async function handleSkillReported(token: string, generation: number) {
    const refreshed = await fetchTeamSkills(token, teamId);
    if (!isCurrentGeneration(generation)) {
      return;
    }

    setState((previous) => {
      if (previous.phase !== "loaded" || !isCurrentGeneration(generation)) {
        return previous;
      }
      const { result } = previous;
      if (result.status !== "authorized" && result.status !== "results_unavailable") {
        return previous;
      }
      return {
        ...previous,
        result: { ...result, skills: toSkillSectionState(refreshed) },
      };
    });
  }

  /**
   * Navigates to the newly created thread's detail view (docs/features/
   * team-forum/SPEC.md — "Product behavior" #2). Discarded, per BR-46, if
   * the caller has since signed out or navigated to a different team before
   * `CreateThreadForm`'s own request resolves — never navigates on behalf of
   * a superseded auth state or route.
   */
  function handleThreadCreated(generation: number, threadId: string) {
    if (!isCurrentGeneration(generation)) {
      return;
    }
    router.push(`/teams/${encodeURIComponent(teamId)}/forum/${encodeURIComponent(threadId)}`);
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

  if (result.status === "results_unavailable") {
    return (
      <div className="flex flex-col gap-4">
        <TeamHeading name={result.name} />
        <TeamRouteNav teamId={teamId} />
        <Alert variant="error">{teamsCopy.detail.resultsUnavailable}</Alert>
        <ResultaterZone>
          <CurrentSurveySection state={result.currentSurvey} />
        </ResultaterZone>
        <TeamaktivitetZone>
          <ChallengesSection
            teamId={teamId}
            token={token}
            state={result.challenges}
            onSubmitted={() => handleChallengeSubmitted(token, generation)}
          />
          {forumEnabled && (
            <ForumSection
              teamId={teamId}
              token={token}
              state={result.forum}
              onThreadCreated={(threadId) => handleThreadCreated(generation, threadId)}
            />
          )}
          <RoadmapPlanningScope key={generation} token={token} teamId={teamId}>
            {(planning) => (
              <TeamSkillSection
                idToken={token}
                teamId={teamId}
                state={toTeamSkillSectionState(result.skills)}
                onReported={() => handleSkillReported(token, generation)}
                planning={planning}
              />
            )}
          </RoadmapPlanningScope>
          <TeamSkillNeedsSection key={generation} teamId={teamId} token={token} teamName={result.name} />
          <TeamRosterSection key={generation} teamId={teamId} token={token} />
        </TeamaktivitetZone>
      </div>
    );
  }

  if (result.status === "authorized") {
    // Results are chronological ascending, oldest first (BR-28) — the
    // latest eligible completed survey is always the last entry, never
    // inferred from `CurrentSurveySection`'s independent scheduled/open
    // discovery (docs/features/managed-surveys/SPEC.md — "Current/latest
    // result" and "current-survey discovery ... remain separate contracts").
    const latest = result.results[result.results.length - 1] ?? null;
    return (
      <div className="flex flex-col gap-8">
        <TeamHeading name={result.name} />
        <TeamRouteNav teamId={teamId} />
        <ResultaterZone>
          <CurrentSurveySection state={result.currentSurvey} />
          <PeriodSummary result={latest} />
          {result.results.length > 0 && (
            <TrendChartBoundary>
              <LazyTrendChart results={result.results} />
            </TrendChartBoundary>
          )}
          <TrendTable results={result.results} />
        </ResultaterZone>
        <TeamaktivitetZone>
          <ChallengesSection
            teamId={teamId}
            token={token}
            state={result.challenges}
            onSubmitted={() => handleChallengeSubmitted(token, generation)}
          />
          {forumEnabled && (
            <ForumSection
              teamId={teamId}
              token={token}
              state={result.forum}
              onThreadCreated={(threadId) => handleThreadCreated(generation, threadId)}
            />
          )}
          <RoadmapPlanningScope key={generation} token={token} teamId={teamId}>
            {(planning) => (
              <TeamSkillSection
                idToken={token}
                teamId={teamId}
                state={toTeamSkillSectionState(result.skills)}
                onReported={() => handleSkillReported(token, generation)}
                planning={planning}
              />
            )}
          </RoadmapPlanningScope>
          <TeamSkillNeedsSection key={generation} teamId={teamId} token={token} teamName={result.name} />
          <TeamRosterSection key={generation} teamId={teamId} token={token} />
        </TeamaktivitetZone>
      </div>
    );
  }

  const canRequestAccess = result.relationship === "none" || result.relationship === "request_rejected";

  return (
    <div className="flex flex-col gap-4">
      <TeamHeading name={result.name} />
      <Alert variant="info">{RELATIONSHIP_MESSAGES[result.relationship]}</Alert>
      {actionState.status === "error" && (
        <Alert variant="error">{actionState.message}</Alert>
      )}
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

function TeamHeading({ name }: { name?: string }) {
  return <PageHeader title={name ?? teamsCopy.detail.fallbackName} />;
}

/**
 * Presentation-only visual grouping for the "results" half of `TeamDetail`
 * (docs/features/ui-refresh/SPEC.md — BR-15, BR-16): a plain `<section>` +
 * heading around already-rendered children, never a `Card` — every child
 * section already renders its own `Card as="section"`, so wrapping them in
 * another `Card` would nest cards rather than merely group them. Carries no
 * fetch, state, or capability logic of its own; it only arranges JSX the
 * caller has already fully computed.
 */
function ResultaterZone({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="team-detail-resultater-heading" className="flex flex-col gap-6">
      <h2
        id="team-detail-resultater-heading"
        className="text-xl font-semibold text-zinc-900 dark:text-zinc-50"
      >
        {teamsCopy.detail.resultaterHeading}
      </h2>
      {children}
    </section>
  );
}

/** The "team activity" counterpart to `ResultaterZone` — identical rationale. */
function TeamaktivitetZone({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="team-detail-teamaktivitet-heading" className="flex flex-col gap-6">
      <h2
        id="team-detail-teamaktivitet-heading"
        className="text-xl font-semibold text-zinc-900 dark:text-zinc-50"
      >
        {teamsCopy.detail.teamaktivitetHeading}
      </h2>
      {children}
    </section>
  );
}

/**
 * `/teams/[teamId]`'s "Pågående undersøkelse" section
 * (docs/features/managed-surveys/SPEC.md — BR-30, BR-31, BR-32). Renders
 * exactly what `getCurrentTeamSurvey` (via `fetchCurrentTeamSurvey`)
 * returned — it never computes lifecycle, availability, or `accessMode`
 * eligibility itself, and never renders response/result content
 * (`.claude/rules/security.md`).
 */
function CurrentSurveySection({ state }: { state: CurrentSurveySectionState }) {
  return (
    <Card as="section" variant="bordered" padding="md" aria-labelledby="current-survey-heading">
      <h2
        id="current-survey-heading"
        className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
      >
        {surveysCopy.teamCurrent.sectionTitle}
      </h2>
      {state.status === "unavailable" && (
        <Alert variant="error" className="mt-4">
          {surveysCopy.teamCurrent.error}
        </Alert>
      )}
      {state.status === "loaded" && state.survey === null && (
        <EmptyState className="mt-4">{surveysCopy.teamCurrent.empty}</EmptyState>
      )}
      {state.status === "loaded" && state.survey !== null && (
        <CurrentSurveyCard survey={state.survey} />
      )}
    </Card>
  );
}

/**
 * `/teams/[teamId]`'s "Utfordringer" section (docs/features/
 * anonymous-challenges/SPEC.md — TASK-005, BR-27). Composes the submission
 * panel and the read-only member challenge list — the read-only list is
 * shown to any authorized member/admin, independently of whether
 * results/current-survey succeeded (BR-27). Renders exactly what
 * `fetchTeamChallenges` returned; no archived-challenge or status-based
 * filtering logic of any kind lives here or in `ChallengeList` — TASK-003's
 * `listTeamChallengesForMember` already guarantees an archived challenge
 * never reaches this component (`.claude/rules/security.md`).
 *
 * The submission panel itself is gated on `state.canSubmit` (debug fix —
 * Challenge submission composition gap: this section previously rendered
 * `ChallengeSubmissionPanel` for any authorized viewer, including an
 * app-admin-only viewer with no genuine team membership, who would always
 * be rejected `forbidden` by `submitChallenge` on actual submission —
 * BR-1). `canSubmit` is a server-derived signal re-using the same real-
 * membership semantics `submitChallenge` itself requires; it is never
 * inferred client-side from admin status or the broader
 * `authorizeTeamAccess`-style relationship. While the list read itself is
 * `"unavailable"` (including the rare admin-only-viewer edge case where
 * `canSubmit` genuinely cannot be known yet), the submission form is not
 * shown either — the existing read-only list/empty/error states are
 * unaffected either way.
 */
function ChallengesSection({
  teamId,
  token,
  state,
  onSubmitted,
}: {
  teamId: string;
  token: string;
  state: ChallengesSectionState;
  onSubmitted: () => void;
}) {
  const listState: ChallengeListState =
    state.status === "loaded" ? { status: "loaded", challenges: state.challenges } : { status: "error" };
  const canSubmit = state.status === "loaded" && state.canSubmit;

  return (
    <Card as="section" variant="bordered" padding="md" aria-labelledby="challenges-heading">
      <h2 id="challenges-heading" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {challengesCopy.list.sectionTitle}
      </h2>
      {canSubmit && (
        <div className="mt-4">
          <ChallengeSubmissionPanel idToken={token} teamId={teamId} onSubmitted={onSubmitted} />
        </div>
      )}
      <div className="mt-6">
        <ChallengeList state={listState} />
      </div>
    </Card>
  );
}

/**
 * `/teams/[teamId]`'s "Forum" section (docs/features/team-forum/SPEC.md —
 * TASK-005, BR-37, BR-45). Composes the thread-creation form and the
 * read-only thread list — shown to any authorized member/admin,
 * independently of whether results/current-survey/challenges succeeded
 * (BR-45, mirrors `ChallengesSection`'s identical established pattern).
 * Renders exactly what `fetchTeamThreads` returned; no deleted-thread
 * filtering logic of any kind lives here — TASK-002's `listTeamThreads`
 * already guarantees a deleted thread never appears
 * (`.claude/rules/security.md`).
 */
function ForumSection({
  teamId,
  token,
  state,
  onThreadCreated,
}: {
  teamId: string;
  token: string;
  state: ForumSectionState;
  onThreadCreated: (threadId: string) => void;
}) {
  const listState: ThreadListState =
    state.status === "loaded" ? { status: "loaded", threads: state.threads } : { status: "error" };

  return (
    <Card as="section" variant="bordered" padding="md" aria-labelledby="forum-heading">
      <h2 id="forum-heading" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {forumCopy.section.title}
      </h2>
      <div className="mt-4">
        <CreateThreadForm idToken={token} teamId={teamId} onCreated={onThreadCreated} />
      </div>
      <div className="mt-6">
        <ThreadList teamId={teamId} state={listState} />
      </div>
    </Card>
  );
}

function CurrentSurveyCard({ survey }: { survey: CurrentTeamSurveySummary }) {
  const title = survey.title ?? surveysCopy.teamCurrent.fallbackTitle;

  return (
    <div className="mt-4 flex flex-col items-start gap-2">
      <p className="break-words font-medium text-zinc-900 dark:text-zinc-50">{title}</p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {surveysCopy.admin.lifecycleLabels[survey.lifecycle]} ·{" "}
        {surveysCopy.admin.accessModeLabels[survey.accessMode]}
      </p>
      {(survey.startAt !== undefined || survey.endAt !== undefined) && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {survey.startAt !== undefined
            ? `${surveysCopy.teamCurrent.startAtLabel} ${formatSurveyDate(new Date(survey.startAt))}`
            : null}
          {survey.startAt !== undefined && survey.endAt !== undefined ? " · " : null}
          {survey.endAt !== undefined
            ? `${surveysCopy.teamCurrent.endAtLabel} ${formatSurveyDate(new Date(survey.endAt))}`
            : null}
        </p>
      )}
      <Link
        href={`/survey/${encodeURIComponent(survey.surveyId)}`}
        className="font-medium text-zinc-900 underline dark:text-zinc-50"
      >
        {surveysCopy.teamCurrent.answerLink}
      </Link>
    </div>
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

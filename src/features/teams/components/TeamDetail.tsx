"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import {
  fetchTeamResults,
  type SurveyResultSummary,
} from "../../results/client/team-results-gateway";
import { PeriodSummary } from "../../results/components/PeriodSummary";
import { TrendChart } from "../../results/components/TrendChart";
import { TrendTable } from "../../results/components/TrendTable";
import { formatSurveyDate } from "../../results/domain/format-survey-date";
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
 * The composed result this component renders — never a raw gateway
 * response. Only `authorized` ever carries result/aggregate data; every
 * other state is a non-sensitive "you don't have access" variant
 * (docs/features/team-management/SPEC.md — BR-14, BR-15, BR-16).
 */
type TeamDetailResult =
  | { status: "unauthenticated" }
  | { status: "read_failed" }
  | { status: "denied"; name?: string; relationship: DeniedRelationship }
  | { status: "results_unavailable"; name?: string; currentSurvey: CurrentSurveySectionState }
  | {
      status: "authorized";
      name?: string;
      results: SurveyResultSummary[];
      currentSurvey: CurrentSurveySectionState;
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

  // Either a known "admin"/"member" relationship, or no overview entry at
  // all (the ambiguous case) — both resolve via the authoritative results
  // endpoint, never via the overview alone.
  return resolveViaResults(idToken, teamId, entry?.name);
}

async function resolveViaResults(
  idToken: string,
  teamId: string,
  name: string | undefined,
): Promise<TeamDetailResult> {
  // Fetched in parallel — separate server contracts (results vs. current-
  // survey discovery), each independently authorized, so neither read waits
  // on the other (docs/features/managed-surveys/SPEC.md — TASK-010).
  const [results, surveyResult] = await Promise.all([
    fetchTeamResults(idToken, teamId),
    fetchCurrentTeamSurvey(idToken, teamId),
  ]);

  if (results.status === "ok") {
    return {
      status: "authorized",
      name,
      results: results.results,
      currentSurvey: toCurrentSurveySectionState(surveyResult),
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
    // distinguishing existence signal. The parallel current-survey result is
    // discarded here regardless of its own outcome: a denied caller never
    // sees survey data.
    return { status: "denied", name, relationship: "none" };
  }
  return {
    status: "results_unavailable",
    name,
    currentSurvey: toCurrentSurveySectionState(surveyResult),
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

  if (result.status === "results_unavailable") {
    return (
      <div className="flex flex-col gap-4">
        <TeamHeading name={result.name} />
        <Alert variant="error">{teamsCopy.detail.resultsUnavailable}</Alert>
        <CurrentSurveySection state={result.currentSurvey} />
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
        <CurrentSurveySection state={result.currentSurvey} />
        <PeriodSummary result={latest} />
        <TrendChart results={result.results} />
        <TrendTable results={result.results} />
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

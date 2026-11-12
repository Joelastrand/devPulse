"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { catchError } from "next/error";
import { useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { PeriodSummary } from "../../results/components/PeriodSummary";
import { ResultsSummaryStrip } from "../../results/components/ResultsSummaryStrip";
import { TrendTable } from "../../results/components/TrendTable";
import { formatSurveyDate } from "../../results/domain/format-survey-date";
import { resultsCopy } from "../../results/copy";
import {
  fetchTeamResults,
  type SurveyResultSummary,
} from "../../results/client/team-results-gateway";
import {
  fetchCurrentTeamSurvey,
  type CurrentTeamSurveySummary,
  type FetchCurrentTeamSurveyResult,
} from "../../surveys/client/current-team-survey-gateway";
import { surveysCopy } from "../../surveys/copy";
import { TeamSurveyResultsSection } from "../../surveys/components/TeamSurveyResultsSection";
import { teamsCopy } from "../copy";

/**
 * `TrendChart` code-split out of the results route's client bundle
 * (docs/archive/features/performance-phase-a/SPEC.md — TASK-003, AD-3/AD-5). Moved
 * here from `TeamDetail` with the survey history and trend blocks (BR-5 of
 * docs/archive/features/team-experience-redesign/SPEC.md): `recharts` only loads when
 * this route actually renders a chart. Declared at module scope for webpack
 * chunk matching.
 */
const LazyTrendChart = dynamic<{ results: readonly SurveyResultSummary[] }>(
  () => import("../../results/components/TrendChart").then((mod) => mod.TrendChart),
  {
    ssr: false,
    loading: () => <LoadingState label={resultsCopy.trendChart.loading} />,
  },
);

/** Chart-local fallback: static, non-sensitive, never shows the exception message (SPEC → AD-6). */
function TrendChartFallback() {
  return <Alert variant="error">{resultsCopy.trendChart.loadError}</Alert>;
}

/** Isolates a chart chunk-load or render failure to the chart region only (BR-18 of performance-phase-a). */
const TrendChartBoundary = catchError(TrendChartFallback);

type CurrentSurveySectionState =
  | { status: "loaded"; survey: CurrentTeamSurveySummary | null }
  | { status: "unavailable" };

function toCurrentSurveySectionState(result: FetchCurrentTeamSurveyResult): CurrentSurveySectionState {
  return result.status === "ok"
    ? { status: "loaded", survey: result.survey }
    : { status: "unavailable" };
}

/**
 * Composed route state. Only `authorized` carries result data; `forbidden`
 * and `unauthenticated` never carry any survey or result content
 * (`.claude/rules/security.md`). The results read is the authoritative
 * `authorizeTeamAccess`-backed decision for this route.
 */
type ResultsViewState =
  | { phase: "loading" }
  | { phase: "signed_out" }
  | { phase: "forbidden" }
  | { phase: "error" }
  | {
      phase: "loaded";
      results: SurveyResultSummary[];
      currentSurvey: CurrentSurveySectionState;
    };

async function loadResultsView(idToken: string, teamId: string): Promise<ResultsViewState> {
  // Parallel, independently authorized server contracts (results and current-survey discovery).
  const [results, surveyResult] = await Promise.all([
    fetchTeamResults(idToken, teamId),
    fetchCurrentTeamSurvey(idToken, teamId),
  ]);

  if (results.status === "unauthenticated") {
    return { phase: "signed_out" };
  }
  if (results.status === "forbidden") {
    // Same non-sensitive outcome as an unauthorized caller on Oversikt (BR-16): no survey data is kept.
    return { phase: "forbidden" };
  }
  if (results.status !== "ok") {
    return { phase: "error" };
  }
  return {
    phase: "loaded",
    results: results.results,
    currentSurvey: toCurrentSurveySectionState(surveyResult),
  };
}

/**
 * `/teams/[teamId]/results` content (docs/archive/features/team-experience-redesign
 * SPEC — BR-5). Renders the survey history (summary strip, current survey,
 * latest period, trend table) and the trend chart that were previously
 * rendered inside `TeamDetail`, with their existing behavior and copy.
 */
export function TeamResultsView({ teamId }: { teamId: string }) {
  const [state, setState] = useState<ResultsViewState>({ phase: "loading" });

  useAuthGatedResource(
    (token, generation, isCurrentGeneration) => {
      if (!token) {
        setState({ phase: "signed_out" });
        return;
      }
      setState({ phase: "loading" });
      loadResultsView(token, teamId).then((next) => {
        if (isCurrentGeneration(generation)) {
          setState(next);
        }
      });
    },
    [teamId],
  );

  if (state.phase === "loading") {
    return <LoadingState label={teamsCopy.results.loading} />;
  }

  if (state.phase === "signed_out") {
    return (
      <p className="text-text-secondary">
        <Link href="/sign-in" className="font-medium text-text-primary underline">
          {teamsCopy.detail.signInLink}
        </Link>{" "}
        {teamsCopy.results.signIn}
      </p>
    );
  }

  if (state.phase === "forbidden") {
    return <Alert variant="info">{teamsCopy.results.forbidden}</Alert>;
  }

  if (state.phase === "error") {
    return <Alert variant="error">{teamsCopy.results.error}</Alert>;
  }

  const latest = state.results[state.results.length - 1] ?? null;

  return (
    <div className="flex flex-col gap-6" aria-label={teamsCopy.results.title}>
      <ResultsSummaryStrip results={state.results} />
      <CurrentSurveySection state={state.currentSurvey} />
      <PeriodSummary result={latest} />
      <TrendTable results={state.results} />
      {state.results.length > 0 && (
        <TrendChartBoundary>
          <LazyTrendChart results={state.results} />
        </TrendChartBoundary>
      )}
      <TeamSurveyResultsSection teamId={teamId} />
    </div>
  );
}

/**
 * "Pågående undersøkelse" section (docs/archive/features/managed-surveys/SPEC.md —
 * BR-30 through BR-32). Renders exactly what `fetchCurrentTeamSurvey`
 * returned; it never computes eligibility and never renders response content.
 */
function CurrentSurveySection({ state }: { state: CurrentSurveySectionState }) {
  return (
    <Card as="section" variant="bordered" padding="md" aria-labelledby="current-survey-heading">
      <h2 id="current-survey-heading" className="text-lg font-semibold text-text-primary">
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
      {state.status === "loaded" && state.survey !== null && <CurrentSurveyCard survey={state.survey} />}
    </Card>
  );
}

function CurrentSurveyCard({ survey }: { survey: CurrentTeamSurveySummary }) {
  const title = survey.title ?? surveysCopy.teamCurrent.fallbackTitle;

  return (
    <div className="mt-4 flex flex-col items-start gap-2">
      <p className="break-words font-medium text-text-primary">{title}</p>
      <p className="text-sm text-text-secondary">
        {surveysCopy.admin.lifecycleLabels[survey.lifecycle]} ·{" "}
        {surveysCopy.admin.accessModeLabels[survey.accessMode]}
      </p>
      {(survey.startAt !== undefined || survey.endAt !== undefined) && (
        <p className="text-sm text-text-secondary">
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
        className="font-medium text-text-primary underline"
      >
        {surveysCopy.teamCurrent.answerLink}
      </Link>
    </div>
  );
}

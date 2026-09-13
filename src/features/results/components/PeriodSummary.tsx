import { Alert } from "../../../components/ui/Alert";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import type { SurveyResultSummary } from "../client/team-results-gateway";
import { resultsCopy } from "../copy";
import { formatSurveyDate } from "../domain/format-survey-date";

/**
 * Renders the team's latest closed survey's result
 * (docs/features/managed-surveys/SPEC.md — "Results/history model",
 * TASK-012). `result` is `null` only when the team has no closed surveys
 * yet — a `scheduled`/`open` survey is never eligible here (BR-27), so this
 * component never needs to distinguish "no survey" from "current survey not
 * yet closed."
 */
export function PeriodSummary({ result }: { result: SurveyResultSummary | null }) {
  return (
    <Card
      as="section"
      variant="bordered"
      padding="md"
      aria-labelledby="latest-survey-heading"
    >
      <h2
        id="latest-survey-heading"
        className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
      >
        {resultsCopy.latestSurvey.heading}
      </h2>

      {result === null ? (
        <EmptyState className="mt-4">{resultsCopy.latestSurvey.empty}</EmptyState>
      ) : (
        <>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {result.title ? `${result.title} · ` : ""}
            {formatSurveyDate(new Date(result.date))}
          </p>

          {result.status === "published" ? (
            <>
              <dl className="mt-4 grid grid-cols-3 gap-4">
                <div>
                  <dt className="text-sm text-zinc-500 dark:text-zinc-400">
                    {resultsCopy.latestSurvey.dimensions.flow}
                  </dt>
                  <dd className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {result.mean.flow.toFixed(1)}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-zinc-500 dark:text-zinc-400">
                    {resultsCopy.latestSurvey.dimensions.stress}
                  </dt>
                  <dd className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {result.mean.stress.toFixed(1)}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-zinc-500 dark:text-zinc-400">
                    {resultsCopy.latestSurvey.dimensions.fun}
                  </dt>
                  <dd className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {result.mean.fun.toFixed(1)}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                {resultsCopy.latestSurvey.responses(result.count)}
              </p>
            </>
          ) : (
            <Alert variant="info" className="mt-4">
              {resultsCopy.latestSurvey.insufficient(result.minimumResponses)}
            </Alert>
          )}
        </>
      )}
    </Card>
  );
}

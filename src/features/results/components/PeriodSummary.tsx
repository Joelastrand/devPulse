import { Alert } from "../../../components/ui/Alert";
import { Card } from "../../../components/ui/Card";
import type { PeriodAggregateResult } from "../domain/aggregation";
import { resultsCopy } from "../copy";

/**
 * Renders the most recently closed period's aggregate. `not_available`
 * should never actually reach the client for this slot (`getTeamResults`
 * only ever passes closed periods here) but is handled the same as
 * `insufficient` — a generic, non-revealing message — as defense in depth
 * against ever implying open-period data exists (BR-6).
 */
export function PeriodSummary({ result }: { result: PeriodAggregateResult }) {
  return (
    <Card
      as="section"
      variant="bordered"
      padding="md"
      aria-labelledby="current-period-heading"
    >
      <h2
        id="current-period-heading"
        className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
      >
        {resultsCopy.periodSummary.heading}
      </h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{result.period}</p>

      {result.status === "published" ? (
        <>
          <dl className="mt-4 grid grid-cols-3 gap-4">
            <div>
              <dt className="text-sm text-zinc-500 dark:text-zinc-400">
                {resultsCopy.periodSummary.dimensions.flow}
              </dt>
              <dd className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                {result.mean.flow.toFixed(1)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-zinc-500 dark:text-zinc-400">
                {resultsCopy.periodSummary.dimensions.stress}
              </dt>
              <dd className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                {result.mean.stress.toFixed(1)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-zinc-500 dark:text-zinc-400">
                {resultsCopy.periodSummary.dimensions.fun}
              </dt>
              <dd className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                {result.mean.fun.toFixed(1)}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {resultsCopy.periodSummary.responses(result.count)}
          </p>
        </>
      ) : (
        <Alert variant="info" className="mt-4">
          {result.status === "insufficient"
            ? resultsCopy.periodSummary.insufficient
            : resultsCopy.periodSummary.notAvailable}
        </Alert>
      )}
    </Card>
  );
}

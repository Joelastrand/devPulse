import type { PeriodAggregateResult } from "../domain/aggregation";

/**
 * Renders the most recently closed period's aggregate. `not_available`
 * should never actually reach the client for this slot (`getTeamResults`
 * only ever passes closed periods here) but is handled the same as
 * `insufficient` — a generic, non-revealing message — as defense in depth
 * against ever implying open-period data exists (BR-6).
 */
export function PeriodSummary({ result }: { result: PeriodAggregateResult }) {
  return (
    <section
      aria-labelledby="current-period-heading"
      className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-800"
    >
      <h2
        id="current-period-heading"
        className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
      >
        Most recently completed period
      </h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{result.period}</p>

      {result.status === "published" ? (
        <>
          <dl className="mt-4 grid grid-cols-3 gap-4">
            <div>
              <dt className="text-sm text-zinc-500 dark:text-zinc-400">Flow</dt>
              <dd className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                {result.mean.flow.toFixed(1)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-zinc-500 dark:text-zinc-400">Stress</dt>
              <dd className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                {result.mean.stress.toFixed(1)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-zinc-500 dark:text-zinc-400">Fun</dt>
              <dd className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                {result.mean.fun.toFixed(1)}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {result.count} responses
          </p>
        </>
      ) : (
        <p role="status" className="mt-4 text-zinc-600 dark:text-zinc-400">
          {result.status === "insufficient"
            ? "Not enough responses yet for this period."
            : "Not available."}
        </p>
      )}
    </section>
  );
}

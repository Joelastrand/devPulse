import type { PeriodAggregateResult } from "../domain/aggregation";

/**
 * Renders the closed-period trend, each period independently in its own
 * published/insufficient/not_available state (BR-8). Never labeled or
 * implied to include the current/open period.
 */
export function TrendTable({
  results,
}: {
  results: readonly PeriodAggregateResult[];
}) {
  return (
    <section aria-labelledby="trend-heading">
      <h2
        id="trend-heading"
        className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
      >
        Trend (last {results.length} completed periods)
      </h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            Per-dimension pulse averages for the most recent completed
            periods
          </caption>
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th
                scope="col"
                className="py-2 pr-4 font-medium text-zinc-500 dark:text-zinc-400"
              >
                Period
              </th>
              <th
                scope="col"
                className="py-2 pr-4 font-medium text-zinc-500 dark:text-zinc-400"
              >
                Flow
              </th>
              <th
                scope="col"
                className="py-2 pr-4 font-medium text-zinc-500 dark:text-zinc-400"
              >
                Stress
              </th>
              <th
                scope="col"
                className="py-2 pr-4 font-medium text-zinc-500 dark:text-zinc-400"
              >
                Fun
              </th>
              <th
                scope="col"
                className="py-2 font-medium text-zinc-500 dark:text-zinc-400"
              >
                Responses
              </th>
            </tr>
          </thead>
          <tbody>
            {results.map((result) => (
              <tr
                key={result.period}
                className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
              >
                <th
                  scope="row"
                  className="py-2 pr-4 font-normal text-zinc-900 dark:text-zinc-50"
                >
                  {result.period}
                </th>
                {result.status === "published" ? (
                  <>
                    <td className="py-2 pr-4">{result.mean.flow.toFixed(1)}</td>
                    <td className="py-2 pr-4">{result.mean.stress.toFixed(1)}</td>
                    <td className="py-2 pr-4">{result.mean.fun.toFixed(1)}</td>
                    <td className="py-2">{result.count}</td>
                  </>
                ) : (
                  <td
                    colSpan={4}
                    className="py-2 text-zinc-500 dark:text-zinc-400"
                  >
                    {result.status === "insufficient"
                      ? "Not enough responses yet"
                      : "Not available"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

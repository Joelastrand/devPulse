import type { SurveyResultSummary } from "../client/team-results-gateway";
import { resultsCopy } from "../copy";
import { formatSurveyDate } from "../domain/format-survey-date";

/**
 * Renders the team's closed-survey history, each row one actual survey
 * instance in the exact order the server returned (chronological ascending
 * — BR-28), never a fabricated row for a period with no survey. This
 * remains the authoritative accessible representation of the data —
 * `TrendChart` is `aria-hidden` and built from this exact same array
 * (docs/features/managed-surveys/SPEC.md — TASK-012).
 */
export function TrendTable({
  results,
}: {
  results: readonly SurveyResultSummary[];
}) {
  return (
    <section aria-labelledby="trend-heading">
      <h2
        id="trend-heading"
        className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
      >
        {resultsCopy.trendTable.heading}
      </h2>
      {results.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          {resultsCopy.trendTable.empty}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{resultsCopy.trendTable.caption}</caption>
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th
                  scope="col"
                  className="py-2 pr-4 font-medium text-zinc-500 dark:text-zinc-400"
                >
                  {resultsCopy.trendTable.columns.date}
                </th>
                <th
                  scope="col"
                  className="py-2 pr-4 font-medium text-zinc-500 dark:text-zinc-400"
                >
                  {resultsCopy.trendTable.columns.flow}
                </th>
                <th
                  scope="col"
                  className="py-2 pr-4 font-medium text-zinc-500 dark:text-zinc-400"
                >
                  {resultsCopy.trendTable.columns.stress}
                </th>
                <th
                  scope="col"
                  className="py-2 pr-4 font-medium text-zinc-500 dark:text-zinc-400"
                >
                  {resultsCopy.trendTable.columns.fun}
                </th>
                <th
                  scope="col"
                  className="py-2 font-medium text-zinc-500 dark:text-zinc-400"
                >
                  {resultsCopy.trendTable.columns.responses}
                </th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr
                  key={result.surveyId}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                >
                  <th
                    scope="row"
                    className="py-2 pr-4 font-normal text-zinc-900 dark:text-zinc-50"
                  >
                    {result.title ? `${result.title} · ` : ""}
                    {formatSurveyDate(new Date(result.date))}
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
                      {resultsCopy.trendTable.insufficient(result.minimumResponses)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

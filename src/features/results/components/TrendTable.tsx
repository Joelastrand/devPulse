"use client";

import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import { CollapsibleSection } from "../../../components/ui/CollapsibleSection";
import type { SurveyResultSummary } from "../client/team-results-gateway";
import { resultsCopy } from "../copy";
import { formatSurveyDate } from "../domain/format-survey-date";

/** Rows shown before the user asks for the full history. Presentation only; the full array is never trimmed. */
export const TREND_TABLE_INITIAL_ROWS = 5;

/**
 * Renders the team's closed-survey history, each row one actual survey
 * instance in the exact order the server returned (chronological ascending
 * — BR-28), never a fabricated row for a period with no survey. This
 * remains the authoritative accessible representation of the data —
 * `TrendChart` is `aria-hidden` and built from this exact same array
 * (docs/archive/features/managed-surveys/SPEC.md — TASK-012).
 *
 * Inside the expanded section the table shows the most recent rows first
 * limited by `TREND_TABLE_INITIAL_ROWS`, keeping chronological order, with a
 * control to show the full history. Collapsed, the section shows only its summary.
 */
export function TrendTable({
  results,
  open,
  onOpenChange,
}: {
  results: readonly SurveyResultSummary[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const limited = results.length > TREND_TABLE_INITIAL_ROWS && !showAll;
  const visible = limited ? results.slice(results.length - TREND_TABLE_INITIAL_ROWS) : results;

  return (
    <CollapsibleSection
      id="results-survey-history"
      title={resultsCopy.trendTable.heading}
      summary={resultsCopy.trendTable.summary(results.length)}
      open={open}
      onOpenChange={onOpenChange}
    >
      {results.length === 0 ? (
        <p className="mt-4 text-sm text-text-secondary">
          {resultsCopy.trendTable.empty}
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{resultsCopy.trendTable.caption}</caption>
              <thead>
                <tr className="border-b border-border-subtle">
                  <th scope="col" className="py-2 pr-4 font-medium text-text-secondary">
                    {resultsCopy.trendTable.columns.date}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium text-text-secondary">
                    {resultsCopy.trendTable.columns.flow}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium text-text-secondary">
                    {resultsCopy.trendTable.columns.stress}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium text-text-secondary">
                    {resultsCopy.trendTable.columns.fun}
                  </th>
                  <th scope="col" className="py-2 font-medium text-text-secondary">
                    {resultsCopy.trendTable.columns.responses}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((result, index) => (
                  <tr
                    key={`${result.surveyId}:${index}`}
                    className="border-b border-border-subtle last:border-0"
                  >
                    <th scope="row" className="py-2 pr-4 font-normal text-text-primary">
                      {result.title ? `${result.title} · ` : ""}
                      {formatSurveyDate(new Date(result.date))}
                    </th>
                    {result.status === "published" ? (
                      <>
                        <td className="py-2 pr-4 text-text-primary">{result.mean.flow.toFixed(1)}</td>
                        <td className="py-2 pr-4 text-text-primary">{result.mean.stress.toFixed(1)}</td>
                        <td className="py-2 pr-4 text-text-primary">{result.mean.fun.toFixed(1)}</td>
                        <td className="py-2 text-text-primary">{result.count}</td>
                      </>
                    ) : (
                      <td colSpan={4} className="py-2 text-text-secondary">
                        {resultsCopy.trendTable.insufficient(result.minimumResponses)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {results.length > TREND_TABLE_INITIAL_ROWS && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-help text-text-secondary" aria-live="polite">
                {resultsCopy.trendTable.showingCount(visible.length, results.length)}
              </p>
              <Button type="button" variant="tertiary" size="sm" onClick={() => setShowAll(!showAll)}>
                {showAll ? resultsCopy.trendTable.showFewer : resultsCopy.trendTable.showAll(results.length)}
              </Button>
            </div>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}

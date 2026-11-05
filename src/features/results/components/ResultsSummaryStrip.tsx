import { StatusBadge } from "../../../components/ui/StatusBadge";
import { formatSurveyDate } from "../domain/format-survey-date";
import type { DimensionMeansSummary, SurveyResultSummary } from "../client/team-results-gateway";
import { resultsCopy } from "../copy";

const copy = resultsCopy.summaryStrip;
const DIMENSIONS = ["flow", "stress", "fun"] as const;
type Dimension = (typeof DIMENSIONS)[number];

/** A change smaller than this is "uendret". Shown as text, never as a colour alone. */
const FLAT_BAND = 0.05;

export type ChangeDirection = "up" | "down" | "flat";

export function changeDirection(latest: number, previous: number): ChangeDirection {
  const delta = latest - previous;
  if (delta > FLAT_BAND) return "up";
  if (delta < -FLAT_BAND) return "down";
  return "flat";
}

const DIRECTION_WORD: Record<ChangeDirection, string> = {
  up: copy.up,
  down: copy.down,
  flat: copy.flat,
};

function formatMean(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

/**
 * Summary strip at the head of the results section (docs/features/product-experience/
 * SPEC.md — Chart and analytics presentation). It uses only the published results
 * already loaded. A change is shown only when the latest and the previous survey are
 * both published. A withheld value is never shown as a number or as zero.
 */
export function ResultsSummaryStrip({ results }: { results: readonly SurveyResultSummary[] }) {
  const latest = results[results.length - 1];
  if (latest === undefined) {
    return null;
  }

  if (latest.status !== "published") {
    return (
      <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-control border border-border-subtle bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <dt className="text-text-muted">{copy.latest}</dt>
          <dd className="text-text-primary">{formatSurveyDate(new Date(latest.date))}</dd>
        </div>
        <StatusBadge tone="neutral">{copy.insufficient}</StatusBadge>
      </dl>
    );
  }

  const previous = results.length >= 2 ? results[results.length - 2] : undefined;
  const comparable = previous?.status === "published" ? previous : undefined;

  return (
    // The dl's direct children are the term groups (div > dt + dd): the grid is on the dl itself, not on a wrapper div.
    <dl className="grid gap-3 rounded-control border border-border-subtle bg-surface px-4 py-3 sm:grid-cols-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 sm:col-span-3">
        <dt className="text-text-muted">{copy.latest}</dt>
        <dd className="text-text-primary">{formatSurveyDate(new Date(latest.date))}</dd>
      </div>
      {DIMENSIONS.map((dimension) => (
        <DimensionMetric
          key={dimension}
          dimension={dimension}
          latest={latest.mean}
          previous={comparable?.mean}
        />
      ))}
    </dl>
  );
}

function DimensionMetric({
  dimension,
  latest,
  previous,
}: {
  dimension: Dimension;
  latest: DimensionMeansSummary;
  previous: DimensionMeansSummary | undefined;
}) {
  const value = latest[dimension];
  const direction = previous === undefined ? null : changeDirection(value, previous[dimension]);
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-help text-text-muted">{copy.dimensions[dimension]}</dt>
      <dd className="text-metric font-semibold tabular-nums text-text-primary">{formatMean(value)}</dd>
      {direction !== null && (
        <dd className="text-help text-text-secondary">
          {copy.change}: {DIRECTION_WORD[direction]}
        </dd>
      )}
    </div>
  );
}

"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "../../../components/ui/Card";
import type { SurveyResultSummary } from "../client/team-results-gateway";
import { resultsCopy } from "../copy";
import { formatRelativeSurveyDate, formatSurveyDate } from "../domain/format-survey-date";

export interface TrendChartRow {
  surveyId: string;
  date: string;
  relative: string;
  flow: number | null;
  stress: number | null;
  fun: number | null;
  suppressed: boolean;
}

/**
 * The valid single-answer range (`aggregation.ts`'s `MIN_ANSWER`/
 * `MAX_ANSWER`), so a dimension mean is always within `[1, 5]`. Fixing the
 * chart's Y-axis to this exact domain keeps `0` permanently off the visible
 * axis — a suppressed survey can never be misread as "a real value of zero"
 * because zero is never a plottable position at all.
 */
const VALUE_DOMAIN: [number, number] = [1, 5];

/**
 * Maps the same `SurveyResultSummary[]` `TrendTable` already renders into
 * Recharts-ready rows — the single source of truth both the chart and the
 * table derive from (`getTeamSurveyResults`/`computeSurveyAggregate`,
 * unchanged; no new fetch). A suppressed (`insufficient`) survey becomes
 * `null` for every dimension — never `0` and never an interpolated or
 * estimated value (`docs/SECURITY.md` invariants 10-12, SPEC BR-29).
 * Recharts renders a `null` point as a gap (with `connectNulls={false}`)
 * rather than drawing a line through it or plotting a marker at it, so a
 * suppressed survey is a visible break in the trend, never a shape
 * indistinguishable from a real low published value.
 *
 * The X-axis stays categorical (evenly spaced by occurrence, not
 * time-proportional — SPEC → "Chart X-axis decision"): `date` is each
 * survey's actual, formatted date, used as the axis label. `relative` (a
 * secondary, non-load-bearing label like "2 uker siden") is computed here
 * from `now`, never persisted or fetched. Exported for direct,
 * rendering-free testing of this suppression-safe mapping.
 */
export function buildTrendSeries(
  results: readonly SurveyResultSummary[],
  now: Date = new Date(),
): TrendChartRow[] {
  return results.map((result) => {
    const parsedDate = new Date(result.date);
    const base = {
      surveyId: result.surveyId,
      date: formatSurveyDate(parsedDate),
      relative: formatRelativeSurveyDate(parsedDate, now),
    };

    if (result.status !== "published") {
      return { ...base, flow: null, stress: null, fun: null, suppressed: true };
    }
    return {
      ...base,
      flow: result.mean.flow,
      stress: result.mean.stress,
      fun: result.mean.fun,
      suppressed: false,
    };
  });
}

/**
 * Axis tick text takes the theme's muted text colour. Recharts' default tick fill is a grey that measures 2.65:1 on
 * the dark surface (below AA 4.5:1); a presentation attribute cannot read a CSS variable, so the colour is set in style.
 */
const AXIS_TICK = { fontSize: 12, style: { fill: "var(--color-text-muted)" } } as const;

/**
 * One line per dimension, reusing `TrendTable`'s own column labels
 * (BR-2: no duplicate copy source). Each line also carries a distinct dash
 * pattern (solid/dashed/dotted), not just a distinct color, so the three
 * series remain distinguishable without relying on color alone.
 */
const DIMENSION_LINES = [
  { key: "flow" as const, color: "var(--chart-1)", dash: undefined, label: resultsCopy.trendTable.columns.flow },
  { key: "stress" as const, color: "var(--chart-2)", dash: "6 3", label: resultsCopy.trendTable.columns.stress },
  { key: "fun" as const, color: "var(--chart-3)", dash: "2 2", label: resultsCopy.trendTable.columns.fun },
];

function formatTooltipValue(value: unknown): string {
  return typeof value === "number" ? value.toFixed(1) : String(value ?? "");
}

/**
 * Appends each point's secondary relative label to its tooltip title, e.g.
 * "10. jan. 2026 (2 uker siden)" — the relative label is always shown
 * alongside, never instead of, the actual date (SPEC → "Chart X-axis
 * decision").
 */
function formatTooltipLabel(label: unknown, payload: unknown): string {
  const rows = payload as ReadonlyArray<{ payload?: TrendChartRow }> | undefined;
  const relative = rows?.[0]?.payload?.relative;
  return relative ? `${String(label)} (${relative})` : String(label ?? "");
}

/**
 * The survey-instance trend chart (SPEC → "Results/history model",
 * TASK-012), additive to — never replacing — the existing accessible
 * `TrendTable`: it renders the exact same already-fetched `results`
 * `TrendTable` receives (no new fetch, no new server call). The table
 * remains the authoritative accessible rendering of this data: the chart
 * itself is `aria-hidden`, and a visible (non-hidden) heading + description
 * above it explains what it shows and how a suppressed survey is
 * represented, so the information is never conveyed by the chart's
 * shape/color alone.
 */
export function TrendChart({ results, onShowTable }: { results: readonly SurveyResultSummary[]; onShowTable?: () => void }) {
  if (results.length === 0) {
    return null;
  }

  const data = buildTrendSeries(results);
  // A line needs two visible points. Fewer is stated in text, so one result is never read as a trend.
  const visibleCount = results.filter((result) => result.status === "published").length;
  const notice = visibleCount === 0 ? resultsCopy.trendChart.noVisible : visibleCount === 1 ? resultsCopy.trendChart.single : null;

  return (
    <Card as="section" variant="bordered" padding="md" aria-labelledby="trend-chart-heading">
      <h2
        id="trend-chart-heading"
        className="text-lg font-semibold text-text-primary"
      >
        {resultsCopy.trendChart.heading}
      </h2>
      <p className="mt-1 text-sm text-text-secondary">{resultsCopy.trendChart.description}</p>
      {notice !== null ? <p className="mt-2 text-sm font-medium text-text-primary">{notice}</p> : null}
      {/* Text alternative: the chart is hidden from assistive technology, so this states the essentials in text and gives a
          route to every authorized value in the history table, without requiring that table to be open. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-secondary">
        <p>{resultsCopy.trendChart.textSummary(results.length, visibleCount)}</p>
        {onShowTable ? (
          <button type="button" onClick={onShowTable} className="font-medium text-text-primary underline underline-offset-2">
            {resultsCopy.trendChart.showTable}
          </button>
        ) : null}
      </div>
      <div aria-hidden="true" className="mt-4 h-56 w-full sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          {/* The chart is aria-hidden (the table below carries the values); recharts' keyboard layer would make it focusable. */}
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }} accessibilityLayer={false}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
            <XAxis dataKey="date" tick={AXIS_TICK} />
            <YAxis domain={VALUE_DOMAIN} allowDecimals={false} tick={AXIS_TICK} />
            <Tooltip formatter={formatTooltipValue} labelFormatter={formatTooltipLabel} />
            <Legend />
            {DIMENSION_LINES.map(({ key, color, dash, label }) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={label}
                stroke={color}
                strokeDasharray={dash}
                connectNulls={false}
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

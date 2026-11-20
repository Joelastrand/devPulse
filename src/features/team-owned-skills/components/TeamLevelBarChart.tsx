"use client";

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { sortLevelRows, type LevelOrder } from "../domain/level-order";
import { teamCompetenceCopy } from "../workspace-copy";
import { levelBarChartHeight } from "./team-level-bar-layout";

const copy = teamCompetenceCopy.levelChart;

/** One eligible area with a calculated team level. Suppressed or unset areas never reach this chart. */
export interface TeamLevelBarRow {
  readonly skillId: string;
  readonly name: string;
  readonly level: number;
}

const LABEL_LINE_LENGTH = 28;

/** Sorts by area name in Norwegian collation, so the order does not depend on the catalog or on the data arrival order. */
export function sortBarRows(rows: readonly TeamLevelBarRow[]): TeamLevelBarRow[] {
  return sortLevelRows(rows, "name");
}

/** Splits a long area name into at most two lines at word boundaries, so the axis label is not clipped. */
export function wrapAreaLabel(label: string, maxLength: number = LABEL_LINE_LENGTH): string[] {
  const words = label.trim().split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length <= maxLength || current.length === 0) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

interface AreaTickProps {
  readonly x?: number;
  readonly y?: number;
  readonly payload?: { readonly value?: unknown };
}

/** Axis label for one area: wrapped, right-aligned against the bars. */
function AreaTick({ x = 0, y = 0, payload }: AreaTickProps) {
  const lines = wrapAreaLabel(String(payload?.value ?? ""));
  const offset = -((lines.length - 1) * 7);
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill="var(--text-primary)" fontSize={12}>
      {lines.map((line, index) => (
        <tspan key={index} x={x} dy={index === 0 ? offset : 14}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

/**
 * Horizontal bar chart of every eligible team level, on the supported 1–4 scale. The level is also printed as a number at
 * the end of each bar, so the value does not depend on colour or bar length alone. The complete table, rendered by the
 * page, is the text alternative.
 */
/**
 * The heading and description are owned by the page's collapsible section, so this component renders only the chart. The
 * `role="img"` box carries the accessible name; the complete values are in the table view of the same section.
 */
export function TeamLevelBarChart({ rows, order = "name" }: { readonly rows: readonly TeamLevelBarRow[]; readonly order?: LevelOrder }) {
  if (rows.length === 0) return null;
  const data = sortLevelRows(rows, order).map((row) => ({ key: row.skillId, name: row.name, level: row.level }));
  const height = levelBarChartHeight(data.length);

  return (
    <div className="flex flex-col gap-3">
      <div role="img" aria-label={copy.label} className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 32, bottom: 8, left: 8 }} accessibilityLayer={false}>
            <CartesianGrid horizontal={false} stroke="var(--border-subtle)" />
            <XAxis type="number" domain={[0, 4]} ticks={[0, 1, 2, 3, 4]} tick={{ fill: "var(--text-secondary)", fontSize: 12 }} />
            <YAxis type="category" dataKey="name" width={200} interval={0} tick={<AreaTick />} />
            <Bar dataKey="level" fill="var(--chart-1)" isAnimationActive={false}>
              <LabelList dataKey="level" position="right" fill="var(--text-primary)" fontSize={12} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

"use client";

import { useId } from "react";
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from "recharts";
import { SELF_ASSESSED_LEVEL_COPY } from "../../skill-profiles/copy";
import { isSelfAssessedLevel } from "../../skill-profiles/domain/self-assessed-level";
import { KOMPETANSEPROFIL_COPY } from "../radar-copy";
import { buildRadarModel, type RadarAxis, type RadarAxisInput } from "../domain/radar-model";

interface RadarShapePoint {
  readonly x: number;
  readonly y: number;
  readonly value?: unknown;
}

interface RadarShapeProps {
  readonly points?: readonly RadarShapePoint[];
  readonly stroke?: string;
  readonly fill?: string;
  readonly fillOpacity?: number;
  readonly strokeDasharray?: string;
}

/**
 * Splits the points into runs of consecutive drawn values, wrapping around the chart. A missing value (`null`) breaks the
 * run. Recharts places a missing value at the centre, so the shape below never uses Recharts' own polygon for a gap.
 */
export function drawnRuns<T extends { readonly value?: unknown }>(points: readonly T[]): T[][] {
  const start = points.findIndex((point) => point.value === null || point.value === undefined);
  if (start === -1) return [points.slice()];
  const runs: T[][] = [];
  let current: T[] = [];
  for (let step = 1; step <= points.length; step++) {
    const point = points[(start + step) % points.length];
    if (point.value === null || point.value === undefined) {
      if (current.length > 0) runs.push(current);
      current = [];
    } else {
      current.push(point);
    }
  }
  return runs;
}

/**
 * Draws the polygon when every axis has a value. With a gap, draws an open line per run and never closes the shape, so
 * no edge is implied across a missing value. A lone value is drawn as a dot.
 */
function GapAwareRadarShape({ points = [], stroke, fill, fillOpacity, strokeDasharray }: RadarShapeProps) {
  if (points.length === 0) return <g />;
  if (points.every((point) => point.value !== null && point.value !== undefined)) {
    return <polygon points={points.map((point) => `${point.x},${point.y}`).join(" ")} stroke={stroke} fill={fill} fillOpacity={fillOpacity} strokeDasharray={strokeDasharray} />;
  }
  return (
    <g>
      {drawnRuns(points).map((run, index) =>
        run.length === 1 ? (
          <circle key={index} cx={run[0].x} cy={run[0].y} r={3} fill={stroke} />
        ) : (
          <polyline
            key={index}
            points={run.map((point) => `${point.x},${point.y}`).join(" ")}
            stroke={stroke}
            fill="none"
            strokeDasharray={strokeDasharray}
          />
        ),
      )}
    </g>
  );
}

/**
 * Reusable Kompetanseprofil radar (Amendment A §A.4). One component for both modes: the caller supplies team values and
 * targets, and the component never reads member data.
 *
 * - Green filled polygon: «Teamets nivå». Neutral dashed polygon: «Forventet nivå».
 * - `null` is never drawn as zero: an unset value is a gap in the polygon and a «Ikke satt» cell in the table.
 * - The visible table carries the same values as the chart; it is the text alternative and is never hidden.
 * - Colours come from the semantic tokens in app/globals.css, so light and dark mode follow `data-theme`.
 */
/**
 * `showTable` defaults to true: the per-area table is the radar's text alternative. A caller that already renders the same
 * per-area values as text (the collaborative panel's overview) passes `false` to avoid showing them twice.
 */
export function KompetanseprofilRadar({
  axes,
  showTable = true,
}: {
  readonly axes: readonly RadarAxisInput[];
  readonly showTable?: boolean;
}) {
  const headingId = useId();
  const summaryId = useId();
  const model = buildRadarModel(axes);

  if (model.status === "invalid") {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        <h2 id={headingId} className="text-lg font-semibold text-text-primary">
          {KOMPETANSEPROFIL_COPY.title}
        </h2>
        <p className="text-sm text-text-secondary">{KOMPETANSEPROFIL_COPY.invalid}</p>
      </section>
    );
  }

  const message =
    model.status === "too_few_axes"
      ? KOMPETANSEPROFIL_COPY.tooFew
      : model.status === "too_many_axes"
        ? KOMPETANSEPROFIL_COPY.tooMany
        : model.status === "empty"
          ? KOMPETANSEPROFIL_COPY.empty
          : null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="text-lg font-semibold text-text-primary">
        {KOMPETANSEPROFIL_COPY.title}
      </h2>

      {model.status === "ready" ? (
        <>
          <div
            role="img"
            aria-labelledby={headingId}
            aria-describedby={summaryId}
            className="mx-auto h-[280px] w-full max-w-[420px] min-w-[260px]"
          >
            <ResponsiveContainer width="100%" height="100%">
              {/* Recharts' own accessibility layer adds an unnamed, focusable application svg. The table below is the text
                  alternative, so the layer is turned off instead. */}
              <RadarChart data={[...model.points]} outerRadius="60%" accessibilityLayer={false}>
                <PolarGrid stroke="var(--border-strong)" />
                <PolarAngleAxis dataKey="axis" tick={{ fill: "var(--text-secondary)", fontSize: 12 }} />
                <PolarRadiusAxis domain={[0, 4]} tick={false} axisLine={false} />
                <Radar
                  name={KOMPETANSEPROFIL_COPY.legendTeam}
                  dataKey="team"
                  stroke="var(--chart-1)"
                  fill="var(--chart-1)"
                  fillOpacity={0.25}
                  shape={GapAwareRadarShape}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Radar
                  name={KOMPETANSEPROFIL_COPY.legendTarget}
                  dataKey="target"
                  stroke="var(--text-secondary)"
                  strokeDasharray="4 3"
                  fill="none"
                  shape={GapAwareRadarShape}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <p id={summaryId} className="text-sm text-text-secondary">
            {KOMPETANSEPROFIL_COPY.summary(model.setCount, model.axes.length)}
          </p>
        </>
      ) : null}

      {message !== null ? <p className="text-sm text-text-secondary">{message}</p> : null}

      <Legend />

      {showTable && model.axes.length > 0 ? <ProfileTable axes={model.axes} /> : null}
    </section>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-4 text-sm text-text-secondary">
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--chart-1)" }} />
        <span>{KOMPETANSEPROFIL_COPY.legendTeam}</span>
      </li>
      <li className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-0 w-5 border-t-2 border-dashed"
          style={{ borderColor: "var(--text-secondary)" }}
        />
        <span>{KOMPETANSEPROFIL_COPY.legendTarget}</span>
      </li>
    </ul>
  );
}

function levelText(level: number | null): string {
  return level !== null && isSelfAssessedLevel(level) ? SELF_ASSESSED_LEVEL_COPY[level].name : KOMPETANSEPROFIL_COPY.unset;
}

function targetText(level: number | null): string {
  return level !== null && isSelfAssessedLevel(level) ? SELF_ASSESSED_LEVEL_COPY[level].name : KOMPETANSEPROFIL_COPY.noTarget;
}

function ProfileTable({ axes }: { readonly axes: readonly RadarAxis[] }) {
  return (
    <div className="overflow-x-auto" role="region" aria-label={KOMPETANSEPROFIL_COPY.tableCaption} tabIndex={0}>
      <table className="min-w-full text-left text-sm">
        <caption className="sr-only">{KOMPETANSEPROFIL_COPY.tableCaption}</caption>
        <thead>
          <tr className="border-b border-border-subtle">
            <th scope="col" className="py-2 pr-4 font-medium text-text-primary">
              {KOMPETANSEPROFIL_COPY.columnArea}
            </th>
            <th scope="col" className="py-2 pr-4 font-medium text-text-primary">
              {KOMPETANSEPROFIL_COPY.columnTeam}
            </th>
            <th scope="col" className="py-2 font-medium text-text-primary">
              {KOMPETANSEPROFIL_COPY.columnTarget}
            </th>
          </tr>
        </thead>
        <tbody>
          {axes.map((axis) => (
            <tr key={axis.treeId} className="border-b border-border-subtle align-top">
              <th scope="row" className="py-2 pr-4 font-medium text-text-primary">
                {axis.label}
              </th>
              <td className="py-2 pr-4 text-text-secondary">{levelText(axis.teamLevel)}</td>
              <td className="py-2 text-text-secondary">{targetText(axis.targetLevel)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

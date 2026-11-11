"use client";

import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from "recharts";
import { SELF_ASSESSED_LEVEL_COPY, skillProfileCopy } from "../copy";
import type { PersonalRadarPoint } from "../domain/personal-radar";

const AXIS_LABEL_MAX_CHARS = 14;
const AXIS_LABEL_MAX_LINES = 3;

/**
 * Splits a long skill name into short lines for the radar's axis labels, so the labels stay inside the card. Words are kept
 * whole; a single word longer than a line is cut. Lines beyond the maximum end with an ellipsis. The full name stays in the
 * visually hidden table and the list.
 */
export function wrapAxisLabel(text: string, maxChars = AXIS_LABEL_MAX_CHARS, maxLines = AXIS_LABEL_MAX_LINES): string[] {
  const words = text.trim().split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const chunk = word.length > maxChars ? word.slice(0, maxChars) : word;
    const candidate = current === "" ? chunk : `${current} ${chunk}`;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current !== "") lines.push(current);
    current = chunk;
  }
  if (current !== "") lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, Math.max(0, maxChars - 1))}…`;
  return kept;
}

interface AxisTickProps {
  readonly x?: number;
  readonly y?: number;
  readonly textAnchor?: "start" | "middle" | "end" | "inherit";
  readonly payload?: { readonly value?: string };
}

/** Recharts tick renderer: the same text colour as the table, wrapped to short lines. */
function AxisTick({ x = 0, y = 0, textAnchor, payload }: AxisTickProps) {
  const lines = wrapAxisLabel(payload?.value ?? "");
  return (
    <text x={x} y={y} textAnchor={textAnchor} fill="var(--text-secondary)" fontSize={11}>
      {lines.map((line, index) => (
        <tspan key={index} x={x} dy={index === 0 ? 0 : 13}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

/**
 * The signed-in person's own competence radar (individual-skill-self-assessment BR-29 as amended 2026-11-10). One series:
 * the person's own assessed levels. It never receives or shows team, aggregate, role-expectation or other people's data.
 *
 * Accessibility: the chart is `role="img"` with a text label, and the exact level names are in a visually hidden table, so
 * no value is conveyed by shape or colour alone. The 1–4 scale is the canonical level scale (BR-4), so the outer ring is 4.
 */
export function PersonalRadar({
  points,
  unassessedCount,
  omittedByCap,
}: {
  readonly points: readonly PersonalRadarPoint[];
  readonly unassessedCount: number;
  readonly omittedByCap: number;
}) {
  const copy = skillProfileCopy.overview;
  const data = points.map((point) => ({ axis: point.label, own: point.own }));

  return (
    <div className="flex flex-col gap-3">
      <div role="img" aria-label={copy.radarLabel(points.length)} className="mx-auto h-[300px] w-full max-w-[360px]">
        <ResponsiveContainer width="100%" height="100%">
          {/* The visually hidden table below is the text alternative; Recharts' own generated layer is turned off. */}
          <RadarChart data={data} outerRadius="48%" accessibilityLayer={false}>
            <PolarGrid stroke="var(--border-strong)" />
            <PolarAngleAxis dataKey="axis" tick={<AxisTick />} />
            <PolarRadiusAxis domain={[0, 4]} tick={false} axisLine={false} />
            <Radar
              name={copy.radarLegend}
              dataKey="own"
              stroke="var(--chart-1)"
              fill="var(--chart-1)"
              fillOpacity={0.25}
              isAnimationActive={false}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {unassessedCount > 0 ? <p className="text-center text-xs text-text-secondary">{copy.radarUnassessedNote(unassessedCount)}</p> : null}
      {omittedByCap > 0 ? <p className="text-center text-xs text-text-secondary">{copy.radarOmitted(omittedByCap)}</p> : null}

      {/* The wrapper is visually hidden. `sr-only` sets nowrap, which would widen the table's cells and the page; cells must wrap. */}
      <div className="sr-only whitespace-normal">
        <table>
          <caption>{copy.radarTableCaption}</caption>
          <thead>
            <tr>
              <th scope="col">{skillProfileCopy.skillsHeading}</th>
              <th scope="col">{copy.radarLegend}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.treeId}>
                <th scope="row">{point.label}</th>
                <td>{SELF_ASSESSED_LEVEL_COPY[point.own].name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

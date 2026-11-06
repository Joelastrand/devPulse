"use client";

import { Badge } from "../../../components/ui/Badge";
import { buildMemberParticipationRows, formatMonthLabelNb, formatPlanDateNb, type ParticipationInput } from "../domain/project-roadmap-view";
import { todayMarkerPercent, type TimelineWindow } from "../domain/timeline-geometry";
import { teamProjectsCopy } from "../copy";
import type { ClientMember } from "../client/team-projects-gateway";
import { PROJECT_TONE_CLASSES, projectToneIndex } from "./project-presentation";

interface ParticipationPanelProps {
  window: TimelineWindow;
  today: string;
  participations: ParticipationInput[];
  members: ClientMember[];
  membersFailed: boolean;
}

/**
 * Who works on which project in the planned window (SPEC BR-12). Planning intervals only: no utilization, capacity or
 * performance value is computed or shown. Every bar has a text line beneath the chart, so the same information is
 * available without the timeline geometry.
 */
export function ParticipationPanel({ window, today, participations, members, membersFailed }: ParticipationPanelProps) {
  const rows = buildMemberParticipationRows(participations, members, window);
  const marker = todayMarkerPercent(window, today);

  if (rows.length === 0) {
    return <p className="text-label text-text-secondary">{teamProjectsCopy.empty.participation}</p>;
  }

  return (
    <div>
      {membersFailed ? <p className="mb-3 text-help text-text-secondary">{teamProjectsCopy.errors.loadMembers}</p> : null}
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="flex border-b border-border-subtle text-help text-text-secondary">
            <div className="sticky left-0 z-10 w-44 shrink-0 bg-surface px-3 py-2 font-medium">{teamProjectsCopy.section.participation}</div>
            <div className="flex flex-1" aria-hidden="true">
              {window.columns.map((column) => (
                <div
                  key={column.key}
                  className="border-l border-border-subtle px-1 py-2 text-center"
                  style={{ flexGrow: column.dayCount, flexBasis: 0 }}
                >
                  {formatMonthLabelNb(column.month, column.year)}
                </div>
              ))}
            </div>
          </div>
          <ul>
            {rows.map((row) => (
              <li key={row.memberRef} className="flex border-b border-border-subtle last:border-b-0" data-testid="participation-row">
                <div className="sticky left-0 z-10 w-44 shrink-0 bg-surface px-3 py-3 text-label font-medium text-text-primary">
                  {row.displayName ?? teamProjectsCopy.unnamedMember}
                </div>
                <div className="relative flex-1 py-3" style={{ minHeight: 44 }}>
                  {marker !== null ? (
                    <div aria-hidden="true" className="absolute bottom-0 top-0 w-0.5 bg-text-primary opacity-40" style={{ left: `${marker}%` }} />
                  ) : null}
                  {row.bars.map((item) => (
                    <div
                      key={item.participationId}
                      data-testid="participation-bar"
                      className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-full ${PROJECT_TONE_CLASSES[projectToneIndex(item.projectId)].bar} ${item.bar.clippedStart ? "rounded-l-none" : ""} ${item.bar.clippedEnd ? "rounded-r-none" : ""}`}
                      style={{ left: `${item.bar.leftPercent}%`, width: `${item.bar.widthPercent}%` }}
                      aria-hidden="true"
                    />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <ul className="mt-4 space-y-2 text-help text-text-secondary">
        {rows.flatMap((row) =>
          row.bars.map((item) => (
            <li key={`${row.memberRef}-${item.participationId}`} className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-text-primary">{row.displayName ?? teamProjectsCopy.unnamedMember}</span>
              <span>
                {`${item.projectTitle}: ${formatPlanDateNb(item.startDate)} – ${formatPlanDateNb(item.endDate)}`}
              </span>
              {item.overlapsOther ? <Badge>{teamProjectsCopy.overlap}</Badge> : null}
            </li>
          )),
        )}
      </ul>
    </div>
  );
}

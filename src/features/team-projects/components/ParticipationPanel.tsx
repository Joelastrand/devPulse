"use client";

import { buildMemberParticipationRows, formatMonthLabelNb, formatPlanDateNb, type ParticipationBar, type ParticipationInput } from "../domain/project-roadmap-view";
import { todayMarkerPercent, type TimelineWindow } from "../domain/timeline-geometry";
import { teamProjectsCopy } from "../copy";
import type { ClientMember } from "../client/team-projects-gateway";
import { PROJECT_TONE_CLASSES, projectToneIndex } from "./project-presentation";

/** Sub-row height and bar height in px. A member row grows with the number of lanes its overlapping assignments need. */
const LANE_HEIGHT = 28;
const BAR_HEIGHT = 16;
const ROW_PADDING = 12;

interface ParticipationPanelProps {
  window: TimelineWindow;
  today: string;
  participations: ParticipationInput[];
  members: ClientMember[];
  membersFailed: boolean;
  /** Team leads may open an assignment for editing. Ordinary members see the same timeline read-only. */
  canEdit: boolean;
  /** Opens the management form for one assignment. Only called when `canEdit` is true. */
  onEdit: (participationId: string) => void;
}

/**
 * Who works on which project in the planned window (SPEC BR-12). Planning intervals only: no utilization, capacity or
 * performance value is computed or shown. Overlapping assignments of one member sit on separate lanes, each bar has an
 * accessible name with the project and exact dates, and a compact legend names the project colours. The long text list
 * that repeated the bars was removed; the same information is reachable from each bar.
 */
export function ParticipationPanel({ window, today, participations, members, membersFailed, canEdit, onEdit }: ParticipationPanelProps) {
  const rows = buildMemberParticipationRows(participations, members, window);
  const marker = todayMarkerPercent(window, today);
  const legend = buildLegend(rows.flatMap((row) => row.bars));

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {membersFailed ? <p className="text-help text-text-secondary">{teamProjectsCopy.errors.loadMembers}</p> : null}
        <p className="text-label text-text-secondary">{teamProjectsCopy.empty.participation}</p>
        {canEdit ? <p className="text-help text-text-secondary">{teamProjectsCopy.empty.participationLead}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {membersFailed ? <p className="text-help text-text-secondary">{teamProjectsCopy.errors.loadMembers}</p> : null}
      <div className="overflow-x-auto" role="region" aria-label={teamProjectsCopy.section.participationScrollRegion} tabIndex={0}>
        <div className="min-w-[560px]">
          <div className="flex border-b border-border-subtle text-help text-text-secondary">
            <div className="sticky left-0 z-10 w-44 shrink-0 bg-surface px-3 py-2 font-medium">{teamProjectsCopy.section.participationMemberColumn}</div>
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
            {rows.map((row) => {
              const name = row.displayName ?? teamProjectsCopy.unnamedMember;
              return (
                <li key={row.memberRef} className="flex border-b border-border-subtle last:border-b-0" data-testid="participation-row">
                  <div className="sticky left-0 z-10 flex w-44 shrink-0 items-center gap-2 bg-surface px-3 py-3 text-label font-medium text-text-primary">
                    <span
                      aria-hidden="true"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-help font-semibold text-text-secondary"
                    >
                      {initialsOf(row.displayName)}
                    </span>
                    <span className="truncate">{name}</span>
                  </div>
                  <div
                    className="relative flex-1"
                    style={{ minHeight: row.laneCount * LANE_HEIGHT + ROW_PADDING * 2 }}
                  >
                    {marker !== null ? (
                      <div aria-hidden="true" className="absolute bottom-0 top-0 w-0.5 bg-text-primary opacity-40" style={{ left: `${marker}%` }} />
                    ) : null}
                    {row.bars.map((item) => (
                      <ParticipationBarItem
                        key={item.participationId}
                        item={item}
                        memberName={name}
                        canEdit={canEdit}
                        onEdit={onEdit}
                      />
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <ul aria-label={teamProjectsCopy.section.legend} className="flex flex-wrap gap-x-4 gap-y-2 text-help text-text-secondary">
        {legend.map((entry) => (
          <li key={entry.projectId} className="flex items-center gap-2">
            <span aria-hidden="true" className={`inline-block h-3 w-3 shrink-0 rounded-full ${PROJECT_TONE_CLASSES[projectToneIndex(entry.projectId)].dot}`} />
            <span className="text-text-primary">{entry.projectTitle}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface ParticipationBarItemProps {
  item: ParticipationBar;
  memberName: string;
  canEdit: boolean;
  onEdit: (participationId: string) => void;
}

/**
 * One assignment bar. Its accessible name carries the member, project and exact dates; the same text appears in a
 * tooltip on hover and keyboard focus. Overlapping assignments get a dashed outline, so the flag is not carried by
 * colour alone. Team leads get a button that opens the assignment for editing; members get a focusable read-only bar.
 */
function ParticipationBarItem({ item, memberName, canEdit, onEdit }: ParticipationBarItemProps) {
  const dates = `${formatPlanDateNb(item.startDate)} – ${formatPlanDateNb(item.endDate)}`;
  const details = `${item.projectTitle}: ${dates}`;
  const label = teamProjectsCopy.participationBar.label(memberName, item.projectTitle, dates);
  const tooltipId = `participation-tooltip-${item.participationId}`;
  const style = {
    left: `${item.bar.leftPercent}%`,
    width: `${item.bar.widthPercent}%`,
    top: ROW_PADDING + item.lane * LANE_HEIGHT + (LANE_HEIGHT - BAR_HEIGHT) / 2,
    height: BAR_HEIGHT,
  };
  const shape = `rounded-full ${item.bar.clippedStart ? "rounded-l-none" : ""} ${item.bar.clippedEnd ? "rounded-r-none" : ""} ${
    item.overlapsOther ? "border-2 border-dashed border-text-primary" : ""
  }`;
  const tone = PROJECT_TONE_CLASSES[projectToneIndex(item.projectId)].bar;
  const tooltip = (
    <span
      id={tooltipId}
      role="tooltip"
      className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden whitespace-nowrap rounded-control bg-text-primary px-2 py-1 text-help text-surface shadow-card group-hover:block group-focus-visible:block"
    >
      {details}
      {item.overlapsOther ? ` · ${teamProjectsCopy.participationBar.overlap}` : ""}
    </span>
  );

  if (canEdit) {
    return (
      <button
        type="button"
        data-testid="participation-bar"
        onClick={() => onEdit(item.participationId)}
        aria-label={`${label}. ${teamProjectsCopy.actions.editParticipation}`}
        aria-describedby={tooltipId}
        className={`group absolute cursor-pointer ${tone} ${shape} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring`}
        style={style}
      >
        {tooltip}
      </button>
    );
  }

  return (
    <span
      data-testid="participation-bar"
      tabIndex={0}
      role="img"
      aria-label={label}
      aria-describedby={tooltipId}
      className={`group absolute ${tone} ${shape} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring`}
      style={style}
    >
      {tooltip}
    </span>
  );
}

/** One legend entry per project shown in the panel, in first-appearance order. */
function buildLegend(bars: readonly ParticipationBar[]): { projectId: string; projectTitle: string }[] {
  const seen = new Map<string, string>();
  for (const bar of bars) {
    if (!seen.has(bar.projectId)) seen.set(bar.projectId, bar.projectTitle);
  }
  return [...seen].map(([projectId, projectTitle]) => ({ projectId, projectTitle }));
}

/** Up to two initials from a display name, for the decorative avatar. */
function initialsOf(displayName: string | null): string {
  if (displayName === null) return "?";
  const parts = displayName.trim().split(/\s+/).filter((part) => part.length > 0);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

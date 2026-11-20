"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { buildGanttRows, formatMonthLabelNb, formatPlanDateNb, groupProjectsByStatus } from "../domain/project-roadmap-view";
import type { ProjectEffectiveStatus } from "../domain/team-project";
import { todayMarkerPercent, type TimelineWindow } from "../domain/timeline-geometry";
import { teamProjectsCopy } from "../copy";
import type { ClientTeamProject } from "../client/team-projects-gateway";
import { ProjectActionsMenu, ProjectStatusBadge, PROJECT_TONE_CLASSES, projectToneIndex } from "./project-presentation";

interface ProjectGanttProps {
  window: TimelineWindow;
  today: string;
  projects: ClientTeamProject[];
  canEdit: boolean;
  busyProjectId: string | null;
  onEdit: (project: ClientTeamProject) => void;
  onArchive: (project: ClientTeamProject) => void;
}

/**
 * Minimum drawn width of a bar in px. A one-day project stays visible and clickable-sized without implying a longer span:
 * its accessible name and tooltip still state the exact dates.
 */
const MIN_BAR_PX = 6;

/**
 * Project plan timeline (TASK-005, reference 19). Projects are grouped by effective status; each group header toggles its
 * rows. Desktop: a month-header timeline with bars placed from real start and end dates. Each row keeps its name, status
 * and one `Flere handlinger` trigger in a sticky label column, so the timeline scrolls without hiding the row's name.
 * Narrow screens: the same projects as accessible cards with the dates written out. Both renderings read the same row data
 * and the same collapsed state. All groups start expanded.
 */
export function ProjectGantt({ window, today, projects, canEdit, busyProjectId, onEdit, onArchive }: ProjectGanttProps) {
  const rows = buildGanttRows(projects, window);
  const projectById = new Map(projects.map((project) => [project.projectId, project]));
  const marker = todayMarkerPercent(window, today);
  const groups = groupProjectsByStatus(projects);
  const [collapsed, setCollapsed] = useState<ReadonlySet<ProjectEffectiveStatus>>(() => new Set());

  function toggleGroup(status: ProjectEffectiveStatus) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  return (
    <>
      <div className="hidden md:block">
        <div className="overflow-x-auto" role="region" aria-label={teamProjectsCopy.section.planScrollRegion} tabIndex={0}>
          <div className="min-w-[720px]">
            <div className="flex border-b border-border-subtle text-label text-text-secondary">
              <div className="sticky left-0 z-10 w-64 shrink-0 bg-surface px-3 py-2 font-medium">Prosjekt</div>
              <div className="flex flex-1" aria-hidden="true">
                {window.columns.map((column) => (
                  <div
                    key={column.key}
                    className="border-l border-border-subtle px-2 py-2 text-center"
                    style={{ flexGrow: column.dayCount, flexBasis: 0 }}
                  >
                    {formatMonthLabelNb(column.month, column.year)}
                  </div>
                ))}
              </div>
            </div>
            {groups.map((group) => {
              const open = !collapsed.has(group.status);
              const groupRows = rows.filter((row) => group.projects.some((project) => project.projectId === row.projectId));
              return (
                <div key={group.status} data-testid="gantt-group" data-status={group.status}>
                  <GroupHeader status={group.status} count={group.projects.length} open={open} onToggle={toggleGroup} />
                  {open ? (
                    <ul id={groupPanelId(group.status)} aria-label={`${teamProjectsCopy.section.plan}: ${teamProjectsCopy.status[group.status]}`} className="relative">
                      {groupRows.map((row) => {
                        const project = projectById.get(row.projectId);
                        if (!project) return null;
                        const tone = PROJECT_TONE_CLASSES[projectToneIndex(project.projectId)];
                        const bar = row.bar;
                        const clipNote = [
                          bar?.clippedStart ? teamProjectsCopy.clippedStart : null,
                          bar?.clippedEnd ? teamProjectsCopy.clippedEnd : null,
                        ]
                          .filter(Boolean)
                          .join(", ");
                        const dates = `${formatPlanDateNb(project.startDate)} – ${formatPlanDateNb(project.endDate)}`;
                        const barLabel = `${project.title}: ${formatPlanDateNb(project.startDate)} til ${formatPlanDateNb(project.endDate)}${clipNote ? `, ${clipNote}` : ""}`;
                        return (
                          <li key={row.projectId} className="flex items-stretch border-b border-border-subtle last:border-b-0" data-testid="gantt-row">
                            <div className="sticky left-0 z-10 flex w-64 shrink-0 items-start gap-2 bg-surface px-3 py-2.5">
                              <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <span className="flex min-w-0 items-start gap-2 text-label font-medium text-text-primary">
                                  <span aria-hidden="true" className={`mt-1.5 inline-block h-3 w-3 shrink-0 rounded-full ${tone.dot}`} />
                                  <span className="min-w-0 break-words">{project.title}</span>
                                </span>
                                <ProjectStatusBadge project={project} />
                              </div>
                              {canEdit ? (
                                <ProjectActionsMenu
                                  project={project}
                                  busy={busyProjectId === project.projectId}
                                  onEdit={onEdit}
                                  onArchive={onArchive}
                                  placement="inline"
                                />
                              ) : null}
                            </div>
                            <div className="relative flex-1 py-4" style={{ minHeight: 56 }}>
                              {window.columns.map((column) => (
                                <div
                                  key={column.key}
                                  aria-hidden="true"
                                  className="absolute bottom-0 top-0 border-l border-border-subtle"
                                  style={{ left: `${(column.startDay / window.totalDays) * 100}%` }}
                                />
                              ))}
                              {marker !== null ? (
                                <div aria-hidden="true" className="absolute bottom-0 top-0 w-0.5 bg-primary" style={{ left: `${marker}%` }} />
                              ) : null}
                              {bar ? (
                                <div
                                  data-testid="gantt-bar"
                                  role="img"
                                  tabIndex={0}
                                  aria-label={barLabel}
                                  className="group absolute top-1/2 h-4 -translate-y-1/2 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                                  style={{ left: `${bar.leftPercent}%`, width: `${bar.widthPercent}%`, minWidth: MIN_BAR_PX }}
                                >
                                  <span
                                    aria-hidden="true"
                                    className={`block h-full w-full ${tone.bar} ${bar.clippedStart ? "rounded-l-none" : "rounded-l-full"} ${bar.clippedEnd ? "rounded-r-none" : "rounded-r-full"}`}
                                  />
                                  <span
                                    aria-hidden="true"
                                    className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden whitespace-nowrap rounded-control bg-text-primary px-2 py-1 text-help text-surface shadow-card group-hover:block group-focus-visible:block"
                                  >
                                    {`${dates} · ${teamProjectsCopy.status[project.effectiveStatus]} · ${teamProjectsCopy.priority[project.priority]}${clipNote ? ` · ${clipNote}` : ""}`}
                                  </span>
                                </div>
                              ) : (
                                <span className="absolute left-2 top-1/2 z-10 max-w-[calc(100%-1rem)] -translate-y-1/2 rounded-control bg-surface px-1 text-label text-text-secondary">
                                  {teamProjectsCopy.noBar}
                                </span>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        <p className="mt-2 text-label text-text-secondary">
          {marker !== null
            ? `${teamProjectsCopy.today}: ${formatPlanDateNb(today)}`
            : `${teamProjectsCopy.todayOutside}: ${formatPlanDateNb(today)}`}
        </p>
      </div>

      <div className="space-y-4 md:hidden">
        {groups.map((group) => {
          const open = !collapsed.has(group.status);
          return (
            <div key={group.status} data-testid="gantt-group" data-status={group.status}>
              <GroupHeader status={group.status} count={group.projects.length} open={open} onToggle={toggleGroup} />
              {open ? (
                <ul className="mt-3 space-y-3" id={groupPanelId(group.status)} aria-label={`${teamProjectsCopy.section.plan}: ${teamProjectsCopy.status[group.status]}`}>
                  {group.projects.map((project) => (
                    <li key={project.projectId} className="flex items-start gap-3 rounded-control border border-border-subtle bg-surface p-3" data-testid="project-card">
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <span className="flex min-w-0 items-start gap-2 text-label font-semibold text-text-primary">
                          <span aria-hidden="true" className={`mt-1.5 inline-block h-3 w-3 shrink-0 rounded-full ${PROJECT_TONE_CLASSES[projectToneIndex(project.projectId)].dot}`} />
                          <span className="min-w-0 break-words">{project.title}</span>
                        </span>
                        <ProjectStatusBadge project={project} />
                        <p className="text-help text-text-secondary">{`${formatPlanDateNb(project.startDate)} – ${formatPlanDateNb(project.endDate)}`}</p>
                      </div>
                      {canEdit ? (
                        <ProjectActionsMenu project={project} busy={busyProjectId === project.projectId} onEdit={onEdit} onArchive={onArchive} />
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

function groupPanelId(status: ProjectEffectiveStatus): string {
  return `project-group-${status}`;
}

/** Full-width group header. A real button with `aria-expanded`; the status is text, the count is written out. */
function GroupHeader({
  status,
  count,
  open,
  onToggle,
}: {
  status: ProjectEffectiveStatus;
  count: number;
  open: boolean;
  onToggle: (status: ProjectEffectiveStatus) => void;
}) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <h3 className="m-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={groupPanelId(status)}
        onClick={() => onToggle(status)}
        className="flex w-full items-center gap-2 bg-surface-subtle px-3 py-2 text-left text-label font-semibold text-text-primary"
      >
        <Chevron aria-hidden="true" className="size-4 shrink-0" />
        <span>{teamProjectsCopy.status[status]}</span>
        <span className="font-normal text-text-secondary">· {teamProjectsCopy.group.count(count)}</span>
        <span className="sr-only">{open ? teamProjectsCopy.group.collapse : teamProjectsCopy.group.expand}</span>
      </button>
    </h3>
  );
}

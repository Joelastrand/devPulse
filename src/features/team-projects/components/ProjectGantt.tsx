"use client";

import { buildGanttRows, formatMonthLabelNb, formatPlanDateNb } from "../domain/project-roadmap-view";
import { todayMarkerPercent, type TimelineWindow } from "../domain/timeline-geometry";
import { teamProjectsCopy } from "../copy";
import type { ClientTeamProject } from "../client/team-projects-gateway";
import { ProjectStatusBadge, ProjectRowActions, PROJECT_TONE_CLASSES, projectToneIndex } from "./project-presentation";

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
 * Project plan (TASK-005, reference 19). Desktop: a month-header timeline with bars placed from real start and end
 * dates. Narrow screens: the same projects as accessible cards with the dates written out, so no information depends on
 * the bar geometry. Both renderings read the same row data.
 */
export function ProjectGantt({ window, today, projects, canEdit, busyProjectId, onEdit, onArchive }: ProjectGanttProps) {
  const rows = buildGanttRows(projects, window);
  const projectById = new Map(projects.map((project) => [project.projectId, project]));
  const marker = todayMarkerPercent(window, today);

  return (
    <>
      <div className="hidden md:block">
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="flex border-b border-border-subtle text-label text-text-secondary">
              <div className="sticky left-0 z-10 w-56 shrink-0 bg-surface px-3 py-2 font-medium">Prosjekt</div>
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
            <ul aria-label={teamProjectsCopy.section.plan} className="relative">
              {rows.map((row) => {
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
                return (
                  <li key={row.projectId} className="flex items-stretch border-b border-border-subtle last:border-b-0" data-testid="gantt-row">
                    <div className="sticky left-0 z-10 flex w-56 shrink-0 flex-col justify-center gap-1 bg-surface px-3 py-3">
                      <span className="flex items-center gap-2 text-label font-medium text-text-primary">
                        <span aria-hidden="true" className={`inline-block h-3 w-3 shrink-0 rounded-full ${tone.dot}`} />
                        {project.title}
                      </span>
                      <ProjectStatusBadge project={project} />
                      {canEdit ? (
                        <ProjectRowActions project={project} busy={busyProjectId === project.projectId} onEdit={onEdit} onArchive={onArchive} />
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
                        <div aria-hidden="true" className="absolute bottom-0 top-0 w-0.5 bg-text-primary" style={{ left: `${marker}%` }} />
                      ) : null}
                      {bar ? (
                        <div
                          data-testid="gantt-bar"
                          className={`absolute top-1/2 h-4 -translate-y-1/2 ${tone.bar} ${bar.clippedStart ? "rounded-l-none" : "rounded-l-full"} ${bar.clippedEnd ? "rounded-r-none" : "rounded-r-full"}`}
                          style={{ left: `${bar.leftPercent}%`, width: `${bar.widthPercent}%` }}
                        >
                          <span className="sr-only">
                            {`${project.title}: ${formatPlanDateNb(project.startDate)} til ${formatPlanDateNb(project.endDate)}${clipNote ? `, ${clipNote}` : ""}`}
                          </span>
                        </div>
                      ) : (
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-label text-text-secondary">
                          {teamProjectsCopy.noBar}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        <p className="mt-2 text-label text-text-secondary">
          {marker !== null
            ? `${teamProjectsCopy.today}: ${formatPlanDateNb(today)}`
            : `${teamProjectsCopy.todayOutside}: ${formatPlanDateNb(today)}`}
        </p>
      </div>

      <ul className="space-y-3 md:hidden" aria-label={teamProjectsCopy.section.plan}>
        {projects.map((project) => (
          <li key={project.projectId} className="rounded-control border border-border-subtle bg-surface p-4" data-testid="project-card">
            <div className="flex items-start justify-between gap-3">
              <span className="flex items-center gap-2 text-label font-semibold text-text-primary">
                <span aria-hidden="true" className={`inline-block h-3 w-3 shrink-0 rounded-full ${PROJECT_TONE_CLASSES[projectToneIndex(project.projectId)].dot}`} />
                {project.title}
              </span>
              <ProjectStatusBadge project={project} />
            </div>
            <p className="mt-2 text-label text-text-secondary">
              {`${formatPlanDateNb(project.startDate)} – ${formatPlanDateNb(project.endDate)}`}
            </p>
            {canEdit ? (
              <div className="mt-3">
                <ProjectRowActions project={project} busy={busyProjectId === project.projectId} onEdit={onEdit} onArchive={onArchive} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

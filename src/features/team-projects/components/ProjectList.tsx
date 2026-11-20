"use client";

import { isValidPlanDate } from "../../roadmap/domain/roadmap-dates";
import { formatPlanDateNb, groupProjectsByStatus, inclusiveDayCount } from "../domain/project-roadmap-view";
import { barForRange, type TimelineWindow } from "../domain/timeline-geometry";
import { teamProjectsCopy } from "../copy";
import type { ClientTeamProject } from "../client/team-projects-gateway";
import { ProjectActionsMenu, ProjectStatusBadge, PROJECT_TONE_CLASSES, projectToneIndex } from "./project-presentation";

interface ProjectListProps {
  /** The visible period. Used only to say which projects lie outside it; it never changes a project's dates. */
  window: TimelineWindow;
  /** Already filtered by status, so the list and the timeline always show the same projects. */
  projects: ClientTeamProject[];
  canEdit: boolean;
  busyProjectId: string | null;
  onEdit: (project: ClientTeamProject) => void;
  onArchive: (project: ClientTeamProject) => void;
}

/**
 * Project list view (Prosjektplan, `Liste`). The same authorized projects as the timeline, one compact row each: name,
 * status and priority, the start and end dates, the duration, and the lead-only action trigger. Projects outside the
 * selected period are labelled, not hidden. The rows are plain list items, so they reflow on narrow screens without a
 * wide table.
 */
export function ProjectList({ window, projects, canEdit, busyProjectId, onEdit, onArchive }: ProjectListProps) {
  const groups = groupProjectsByStatus(projects);

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.status} aria-labelledby={`project-list-${group.status}`} data-testid="project-list-group" data-status={group.status}>
          <h3 id={`project-list-${group.status}`} className="pb-2 text-label font-semibold text-text-primary">
            {teamProjectsCopy.status[group.status]}
            <span className="font-normal text-text-secondary"> · {teamProjectsCopy.group.count(group.projects.length)}</span>
          </h3>
          <ul className="divide-y divide-border-subtle rounded-control border border-border-subtle">
            {group.projects.map((project) => {
              const datesValid = isValidPlanDate(project.startDate) && isValidPlanDate(project.endDate);
              const onTimeline = datesValid && barForRange(window, project.startDate, project.endDate) !== null;
              const tone = PROJECT_TONE_CLASSES[projectToneIndex(project.projectId)];
              return (
                <li key={project.projectId} data-testid="project-list-row" className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
                  <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1.5">
                    <span className="flex min-w-0 items-start gap-2 text-label font-medium text-text-primary">
                      <span aria-hidden="true" className={`mt-1.5 inline-block h-3 w-3 shrink-0 rounded-full ${tone.dot}`} />
                      <span className="min-w-0 break-words">{project.title}</span>
                    </span>
                    <ProjectStatusBadge project={project} />
                  </div>
                  <div className="flex flex-col gap-0.5 text-label text-text-secondary">
                    <span>
                      {datesValid
                        ? `${formatPlanDateNb(project.startDate)} – ${formatPlanDateNb(project.endDate)}`
                        : teamProjectsCopy.list.datesMissing}
                    </span>
                    {datesValid ? (
                      <span className="text-help">{teamProjectsCopy.list.duration(inclusiveDayCount(project.startDate, project.endDate))}</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {datesValid && !onTimeline ? <span className="text-help text-text-secondary">{teamProjectsCopy.noBar}</span> : null}
                    {canEdit ? (
                      <ProjectActionsMenu
                        project={project}
                        busy={busyProjectId === project.projectId}
                        onEdit={onEdit}
                        onArchive={onArchive}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

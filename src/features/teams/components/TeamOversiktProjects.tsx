"use client";

import Link from "next/link";
import { Card } from "../../../components/ui/Card";
import { ProjectStatusBadge } from "../../team-projects/components/project-presentation";
import type { ClientTeamProject } from "../../team-projects/client/team-projects-gateway";

/** Norwegian copy for the compact project list. Kept local so this module does not import the summary (no cycle). */
const PROJECTS_COPY = {
  heading: "Prosjekter",
  empty: "Ingen aktive eller planlagte prosjekter.",
  loading: "Laster…",
  unavailable: "Kunne ikke lastes",
  forbidden: "Kun for teamledere",
  goTo: "Gå til",
  roadmap: "Roadmap",
} as const;

/** The projects read already made by the Oversikt summary. The list never issues its own request. */
export type ProjectsRead =
  | { status: "loading" }
  | { status: "ok"; projects: readonly ClientTeamProject[] }
  | { status: "forbidden" }
  | { status: "unavailable" };

/** Compact list size on Oversikt (reference 18); the full list lives in Roadmap. */
const COMPACT_LIMIT = 5;

const DATE_FORMAT = new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function formatDay(isoDate: string): string {
  return DATE_FORMAT.format(new Date(`${isoDate}T00:00:00Z`));
}

/** Active projects first, then planned, each ordered by start date. Archived and completed projects are not in the compact list. */
export function compactProjects(projects: readonly ClientTeamProject[]): ClientTeamProject[] {
  const eligible = projects.filter((project) => !project.archived && project.effectiveStatus !== "completed");
  const active = eligible.filter((project) => project.effectiveStatus === "active");
  const planned = eligible.filter((project) => project.effectiveStatus === "planned");
  const byStart = (a: ClientTeamProject, b: ClientTeamProject) => a.startDate.localeCompare(b.startDate);
  return [...active.sort(byStart), ...planned.sort(byStart)].slice(0, COMPACT_LIMIT);
}

export function TeamOversiktProjects({ teamId, read }: { teamId: string; read: ProjectsRead }) {
  const roadmapHref = `/teams/${encodeURIComponent(teamId)}/roadmap`;
  return (
    <Card as="section" variant="bordered" padding="md" aria-labelledby="team-oversikt-projects" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="team-oversikt-projects" className="text-section-title font-semibold text-text-primary">
          {PROJECTS_COPY.heading}
        </h2>
        {read.status === "ok" ? (
          <Link
            href={roadmapHref}
            className="text-sm font-medium text-text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {PROJECTS_COPY.goTo} {PROJECTS_COPY.roadmap}
          </Link>
        ) : null}
      </div>
      {read.status === "loading" ? (
        <p className="text-sm text-text-secondary" aria-live="polite">{PROJECTS_COPY.loading}</p>
      ) : read.status === "forbidden" ? (
        <p className="text-sm text-text-secondary">{PROJECTS_COPY.forbidden}</p>
      ) : read.status === "unavailable" ? (
        <p className="text-sm font-medium text-text-secondary">{PROJECTS_COPY.unavailable}</p>
      ) : (
        <ProjectRows projects={compactProjects(read.projects)} />
      )}
    </Card>
  );
}

function ProjectRows({ projects }: { projects: ClientTeamProject[] }) {
  if (projects.length === 0) {
    return <p className="text-sm text-text-secondary">{PROJECTS_COPY.empty}</p>;
  }
  return (
    <ul className="flex flex-col divide-y divide-border-subtle" aria-label={PROJECTS_COPY.heading}>
      {projects.map((project) => (
        <li key={project.projectId} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="min-w-0 break-words text-sm font-medium text-text-primary">{project.title}</span>
            <span className="text-xs text-text-secondary">
              {formatDay(project.startDate)} – {formatDay(project.endDate)}
            </span>
          </div>
          <ProjectStatusBadge project={project} />
        </li>
      ))}
    </ul>
  );
}

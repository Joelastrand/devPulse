"use client";

import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { teamProjectsCopy } from "../copy";
import type { ClientTeamProject } from "../client/team-projects-gateway";

/**
 * Bar and dot colours cycle per project from the six chart tokens. Colour never carries the status or the project name
 * alone: every bar and legend entry also names the project in text.
 */
export const PROJECT_TONE_CLASSES = [
  { bar: "bg-chart-1", dot: "bg-chart-1" },
  { bar: "bg-chart-2", dot: "bg-chart-2" },
  { bar: "bg-chart-3", dot: "bg-chart-3" },
  { bar: "bg-chart-4", dot: "bg-chart-4" },
  { bar: "bg-chart-5", dot: "bg-chart-5" },
  { bar: "bg-chart-6", dot: "bg-chart-6" },
] as const;

/** Stable tone index from the opaque project id (not from display order, so sorting never recolours a project). */
export function projectToneIndex(projectId: string): number {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) hash = (hash * 31 + projectId.charCodeAt(i)) >>> 0;
  return hash % PROJECT_TONE_CLASSES.length;
}

/** Text status (`Planlagt`, `Pågår`, `Fullført`) and priority. Always text, never colour alone. */
export function ProjectStatusBadge({ project }: { project: ClientTeamProject }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge>{teamProjectsCopy.status[project.effectiveStatus]}</Badge>
      <span className="text-help text-text-secondary">{teamProjectsCopy.priority[project.priority]}</span>
    </span>
  );
}

interface ProjectRowActionsProps {
  project: ClientTeamProject;
  busy: boolean;
  onEdit: (project: ClientTeamProject) => void;
  onArchive: (project: ClientTeamProject) => void;
}

/** Lead-only actions for one active project. Each button names its project for assistive technology. */
export function ProjectRowActions({ project, busy, onEdit, onArchive }: ProjectRowActionsProps) {
  return (
    <span className="flex flex-wrap gap-2">
      <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => onEdit(project)} aria-label={`${teamProjectsCopy.actions.edit}: ${project.title}`}>
        {teamProjectsCopy.actions.edit}
      </Button>
      <Button type="button" variant="tertiary" size="sm" disabled={busy} onClick={() => onArchive(project)} aria-label={`${teamProjectsCopy.actions.archive}: ${project.title}`}>
        {teamProjectsCopy.actions.archive}
      </Button>
    </span>
  );
}

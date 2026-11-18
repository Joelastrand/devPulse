"use client";

import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { teamProjectsCopy } from "../copy";
import type { ClientTeamProject } from "../client/team-projects-gateway";

/**
 * Bar and dot colours cycle per project through the timeline tokens (globals.css `--timeline-*`). The colour identifies a
 * project only; it encodes no status, so it is the same in the Prosjektplan Gantt and in the participation timeline, where
 * the same project id maps to the same tone. Colour never carries the status or the project name alone: every bar and
 * legend entry also names the project in text, and participation bars keep their dashed outline for overlaps.
 */
export const PROJECT_TONE_CLASSES = [
  { bar: "bg-timeline-1", dot: "bg-timeline-1" },
  { bar: "bg-timeline-2", dot: "bg-timeline-2" },
  { bar: "bg-timeline-3", dot: "bg-timeline-3" },
  { bar: "bg-timeline-4", dot: "bg-timeline-4" },
  { bar: "bg-timeline-5", dot: "bg-timeline-5" },
  { bar: "bg-timeline-6", dot: "bg-timeline-6" },
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

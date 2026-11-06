import { barForRange, type TimelineBar, type TimelineWindow } from "./timeline-geometry";

/**
 * Pure row builders for the project roadmap (SPEC BR-10, BR-11, BR-12; TASK-005). Bars come only from real stored
 * start and end dates. No progress, utilization or capacity value is computed here.
 */

export interface GanttProjectInput {
  projectId: string;
  title: string;
  startDate: string;
  endDate: string;
  archived: boolean;
}

export interface GanttRow {
  projectId: string;
  title: string;
  /** `null` when the project's dates do not overlap the window: the row is listed without a bar. */
  bar: TimelineBar | null;
}

/** Active (non-archived) projects in stored order, each with its bar in the window. Archived projects are excluded. */
export function buildGanttRows(projects: readonly GanttProjectInput[], window: TimelineWindow): GanttRow[] {
  return projects
    .filter((project) => !project.archived)
    .map((project) => ({
      projectId: project.projectId,
      title: project.title,
      bar: barForRange(window, project.startDate, project.endDate),
    }));
}

export interface ParticipationInput {
  participationId: string;
  projectId: string;
  projectTitle: string;
  memberRef: string;
  startDate: string;
  endDate: string;
  overlapsOther: boolean;
  archived: boolean;
}

export interface MemberLabelInput {
  memberRef: string;
  displayName: string | null;
}

export interface ParticipationBar {
  participationId: string;
  projectId: string;
  projectTitle: string;
  startDate: string;
  endDate: string;
  overlapsOther: boolean;
  bar: TimelineBar;
}

export interface MemberParticipationRow {
  memberRef: string;
  /** `null` when the member has no name in the assignable-members read (rendered as "Medlem uten navn"). */
  displayName: string | null;
  bars: ParticipationBar[];
}

/**
 * One row per member that has at least one active participation overlapping the window. Members are sorted by display
 * name, then by reference, so the order is stable across reloads.
 */
export function buildMemberParticipationRows(
  participations: readonly ParticipationInput[],
  members: readonly MemberLabelInput[],
  window: TimelineWindow,
): MemberParticipationRow[] {
  const names = new Map(members.map((member) => [member.memberRef, member.displayName]));
  const rows = new Map<string, MemberParticipationRow>();

  for (const participation of participations) {
    if (participation.archived) continue;
    const bar = barForRange(window, participation.startDate, participation.endDate);
    if (bar === null) continue;
    const row = rows.get(participation.memberRef) ?? {
      memberRef: participation.memberRef,
      displayName: names.get(participation.memberRef) ?? null,
      bars: [],
    };
    row.bars.push({
      participationId: participation.participationId,
      projectId: participation.projectId,
      projectTitle: participation.projectTitle,
      startDate: participation.startDate,
      endDate: participation.endDate,
      overlapsOther: participation.overlapsOther,
      bar,
    });
    rows.set(participation.memberRef, row);
  }

  return [...rows.values()].sort((a, b) => {
    const nameOrder = (a.displayName ?? "￿").localeCompare(b.displayName ?? "￿", "nb");
    return nameOrder !== 0 ? nameOrder : a.memberRef.localeCompare(b.memberRef);
  });
}

const MONTH_ABBREVIATIONS = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"] as const;

/** Norwegian short date for a valid `YYYY-MM-DD`, e.g. `15. jan 2027`. Fixed month names keep output runtime-independent. */
export function formatPlanDateNb(isoDate: string): string {
  const day = Number(isoDate.slice(8, 10));
  const month = Number(isoDate.slice(5, 7));
  return `${day}. ${MONTH_ABBREVIATIONS[month - 1]} ${isoDate.slice(0, 4)}`;
}

/** Month column header, e.g. `nov 2026`. */
export function formatMonthLabelNb(month: number, year: number): string {
  return `${MONTH_ABBREVIATIONS[month - 1]} ${year}`;
}

import { PROJECT_EFFECTIVE_STATUSES, type ProjectEffectiveStatus } from "./team-project";
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

/** Status filter for the project plan. `all` keeps every active project. */
export type ProjectStatusFilter = "all" | ProjectEffectiveStatus;

/** Keeps projects whose effective status matches the filter, in stored order. Never changes the status itself. */
export function filterProjectsByStatus<T extends { effectiveStatus: ProjectEffectiveStatus }>(
  projects: readonly T[],
  filter: ProjectStatusFilter,
): T[] {
  return filter === "all" ? [...projects] : projects.filter((project) => project.effectiveStatus === filter);
}

export interface ProjectStatusGroup<T> {
  status: ProjectEffectiveStatus;
  projects: T[];
}

/**
 * Groups projects by effective status for the plan view. Groups follow `PROJECT_EFFECTIVE_STATUSES` order, empty groups
 * are omitted, and projects keep their stored order inside a group. Grouping never changes a status.
 */
export function groupProjectsByStatus<T extends { effectiveStatus: ProjectEffectiveStatus }>(
  projects: readonly T[],
): ProjectStatusGroup<T>[] {
  return PROJECT_EFFECTIVE_STATUSES.flatMap((status) => {
    const matching = projects.filter((project) => project.effectiveStatus === status);
    return matching.length > 0 ? [{ status, projects: matching }] : [];
  });
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
  /** Sub-row of the member's row. Overlapping assignments of one member never share a lane. */
  lane: number;
}

export interface MemberParticipationRow {
  memberRef: string;
  /** `null` when the member has no name in the assignable-members read (rendered as "Medlem uten navn"). */
  displayName: string | null;
  bars: ParticipationBar[];
  /** Number of lanes the member's bars need. At least 1 for a listed row. */
  laneCount: number;
}

/**
 * Greedy lane assignment for inclusive `YYYY-MM-DD` intervals. Each item takes the first lane whose last interval ends
 * before it starts, so overlapping assignments are drawn on separate sub-rows and never merged into one ambiguous bar.
 * ISO date strings compare correctly as text.
 */
export function assignParticipationLanes<T extends { participationId: string; startDate: string; endDate: string }>(
  items: readonly T[],
): { item: T; lane: number }[] {
  const sorted = [...items].sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate) || a.participationId.localeCompare(b.participationId),
  );
  const laneEnds: string[] = [];
  return sorted.map((item) => {
    let lane = laneEnds.findIndex((end) => end < item.startDate);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endDate);
    } else {
      laneEnds[lane] = item.endDate;
    }
    return { item, lane };
  });
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
  const rows = new Map<string, { memberRef: string; displayName: string | null; items: Omit<ParticipationBar, "lane">[] }>();

  for (const participation of participations) {
    if (participation.archived) continue;
    const bar = barForRange(window, participation.startDate, participation.endDate);
    if (bar === null) continue;
    const row = rows.get(participation.memberRef) ?? {
      memberRef: participation.memberRef,
      displayName: names.get(participation.memberRef) ?? null,
      items: [],
    };
    row.items.push({
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

  return [...rows.values()]
    .map((row) => {
      const laned = assignParticipationLanes(row.items);
      const bars: ParticipationBar[] = laned.map(({ item, lane }) => ({ ...item, lane }));
      const laneCount = bars.reduce((max, item) => Math.max(max, item.lane + 1), 1);
      return { memberRef: row.memberRef, displayName: row.displayName, bars, laneCount };
    })
    .sort((a, b) => {
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

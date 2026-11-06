import { isValidPlanDate } from "../../roadmap/domain/roadmap-dates";

/**
 * Gantt geometry for team projects (SPEC BR-10). Pure calendar arithmetic on
 * `YYYY-MM-DD` strings: day numbers come from UTC midnight of the calendar date,
 * so no local timezone can shift a bar or the today marker by a day.
 */

export const TIMELINE_WINDOW_MONTHS = [3, 6] as const;
export type TimelineWindowMonths = (typeof TIMELINE_WINDOW_MONTHS)[number];

const MS_PER_DAY = 86_400_000;

export interface TimelineMonthColumn {
  /** `YYYY-MM`, stable key. */
  key: string;
  /** Month number 1–12. */
  month: number;
  year: number;
  /** Offset of the first day of this month from the window start, in days. */
  startDay: number;
  /** Days in this month, inside the window. */
  dayCount: number;
}

export interface TimelineWindow {
  months: TimelineWindowMonths;
  /** Inclusive first day of the window, `YYYY-MM-DD` (always the 1st of a month). */
  startDate: string;
  /** Inclusive last day of the window, `YYYY-MM-DD`. */
  endDate: string;
  /** Total days in the window. */
  totalDays: number;
  columns: TimelineMonthColumn[];
}

export interface TimelineBar {
  /** Left edge as a percentage of the window (0–100). */
  leftPercent: number;
  /** Width as a percentage of the window. */
  widthPercent: number;
  /** True when the bar is cut at the window's start or end. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

/** Day number of a valid calendar date (days since 1970-01-01). Caller validates the input. */
function dayNumber(isoDate: string): number {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

function isoFromDayNumber(day: number): string {
  const d = new Date(day * MS_PER_DAY);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Builds a 3- or 6-month window starting on the first day of `anchorDate`'s
 * month. `anchorDate` is a valid `YYYY-MM-DD` (the planning "today" in the
 * caller). Throws on invalid input: callers hold valid dates by construction.
 */
export function buildTimelineWindow(anchorDate: string, months: TimelineWindowMonths): TimelineWindow {
  if (!isValidPlanDate(anchorDate)) {
    throw new Error("buildTimelineWindow requires a valid anchor date (YYYY-MM-DD)");
  }
  const anchorYear = Number(anchorDate.slice(0, 4));
  const anchorMonth = Number(anchorDate.slice(5, 7));
  const startDay = dayNumber(`${anchorYear}-${String(anchorMonth).padStart(2, "0")}-01`);

  const columns: TimelineMonthColumn[] = [];
  let offset = 0;
  for (let i = 0; i < months; i++) {
    const first = new Date(Date.UTC(anchorYear, anchorMonth - 1 + i, 1));
    const year = first.getUTCFullYear();
    const month = first.getUTCMonth() + 1;
    const nextFirst = Date.UTC(year, month, 1);
    const dayCount = Math.round((nextFirst - first.getTime()) / MS_PER_DAY);
    columns.push({
      key: `${year}-${String(month).padStart(2, "0")}`,
      month,
      year,
      startDay: offset,
      dayCount,
    });
    offset += dayCount;
  }

  return {
    months,
    startDate: isoFromDayNumber(startDay),
    endDate: isoFromDayNumber(startDay + offset - 1),
    totalDays: offset,
    columns,
  };
}

/**
 * Bar position for an inclusive `[startDate, endDate]` range. Returns `null`
 * when either date is invalid, the range is reversed, or the range does not
 * overlap the window at all (the project is then listed, not drawn).
 */
export function barForRange(window: TimelineWindow, startDate: string, endDate: string): TimelineBar | null {
  if (!isValidPlanDate(startDate) || !isValidPlanDate(endDate) || startDate > endDate) {
    return null;
  }
  const windowStart = dayNumber(window.startDate);
  const windowEnd = windowStart + window.totalDays - 1;
  const rangeStart = dayNumber(startDate);
  const rangeEnd = dayNumber(endDate);
  if (rangeEnd < windowStart || rangeStart > windowEnd) {
    return null;
  }

  const clampedStart = Math.max(rangeStart, windowStart);
  const clampedEnd = Math.min(rangeEnd, windowEnd);
  const left = clampedStart - windowStart;
  // Inclusive end: a one-day bar covers exactly one day.
  const span = clampedEnd - clampedStart + 1;
  return {
    leftPercent: (left / window.totalDays) * 100,
    widthPercent: (span / window.totalDays) * 100,
    clippedStart: rangeStart < windowStart,
    clippedEnd: rangeEnd > windowEnd,
  };
}

/**
 * Today marker position as a percentage, or `null` when `today` is outside the
 * window (no marker is drawn; the UI shows the date in text instead).
 */
export function todayMarkerPercent(window: TimelineWindow, today: string): number | null {
  if (!isValidPlanDate(today)) return null;
  const windowStart = dayNumber(window.startDate);
  const offset = dayNumber(today) - windowStart;
  if (offset < 0 || offset >= window.totalDays) return null;
  // Centre of the day, so the marker sits inside its column.
  return ((offset + 0.5) / window.totalDays) * 100;
}

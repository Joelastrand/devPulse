/**
 * Computes the current survey period as a UTC ISO week string (e.g. "2026-W36").
 *
 * Accepts an instant, never a period — callers (the API layer) must not accept
 * a client-supplied period value; this function only ever derives the period
 * from "now" (or an explicit instant in tests).
 */
export function getCurrentSurveyPeriod(now: Date = new Date()): string {
  const { isoYear, isoWeek } = getIsoWeekUtc(now);
  return `${isoYear}-W${String(isoWeek).padStart(2, "0")}`;
}

function getIsoWeekUtc(date: Date): { isoYear: number; isoWeek: number } {
  const truncated = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );

  // ISO weekday: Monday = 1 .. Sunday = 7.
  const isoWeekday = truncated.getUTCDay() || 7;
  // Shift to the Thursday of this ISO week; the ISO year is the year that Thursday falls in.
  truncated.setUTCDate(truncated.getUTCDate() + 4 - isoWeekday);

  const isoYear = truncated.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeek = Math.ceil((diffInDays(truncated, yearStart) + 1) / 7);

  return { isoYear, isoWeek };
}

function diffInDays(a: Date, b: Date): number {
  const millisecondsPerDay = 86_400_000;
  return (a.getTime() - b.getTime()) / millisecondsPerDay;
}

/**
 * A period is closed iff it is strictly earlier than the current period.
 * Period strings ("YYYY-Www", zero-padded) compare correctly with `<`
 * because the year prefix dominates and the week is zero-padded to two
 * digits within a year.
 */
export function isPeriodClosed(period: string, currentPeriod: string): boolean {
  return period < currentPeriod;
}

/**
 * Enumerates the `count` closed periods immediately preceding the current
 * one, oldest first, never including the current (open) period.
 *
 * Each preceding period is derived by stepping back N full ISO weeks (7*i
 * days) from `now` and recomputing the ISO week for that instant — never by
 * decrementing the current period *string*, which would require re-deriving
 * ISO week/year rollover rules a second time.
 */
export function listPrecedingClosedPeriods(
  count: number,
  now: Date = new Date(),
): string[] {
  const millisecondsPerDay = 86_400_000;
  const periods: string[] = [];

  for (let i = count; i >= 1; i--) {
    const instant = new Date(now.getTime() - i * 7 * millisecondsPerDay);
    periods.push(getCurrentSurveyPeriod(instant));
  }

  return periods;
}

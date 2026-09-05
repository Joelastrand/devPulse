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

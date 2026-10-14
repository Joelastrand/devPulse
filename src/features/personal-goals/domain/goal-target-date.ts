const TARGET_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 2020;
const MAX_YEAR = 2100;

/**
 * `Måldato` (BR-12): plain `YYYY-MM-DD`, a real calendar date, year 2020–2100.
 * No time, no timezone, no timestamp form. Past dates are valid; there is no
 * overdue concept. Goal-local copy of the roadmap rule (BR-12, AD-7), locked
 * by a parity test.
 */
export function isValidGoalTargetDate(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = TARGET_DATE_PATTERN.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR || year > MAX_YEAR) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

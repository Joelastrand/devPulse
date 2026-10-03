const PLAN_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 2020;
const MAX_YEAR = 2100;

/** Product constant: the calendar the `overdue` indicator is evaluated in. */
export const PLANNING_TIME_ZONE = "Europe/Oslo";

/**
 * `YYYY-MM-DD`, a real calendar date, year 2020–2100. Plain strings: no time,
 * no timezone, no display formatting.
 */
export function isValidPlanDate(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = PLAN_DATE_PATTERN.exec(value);
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

/**
 * Validates the optional start/target pair as a merged result: each present
 * value must be a valid plan date and `startDate <= targetDate` when both are
 * present. ISO strings of equal shape compare correctly lexicographically.
 */
export function validatePlanDateRange(
  startDate: string | undefined,
  targetDate: string | undefined,
): boolean {
  if (startDate !== undefined && !isValidPlanDate(startDate)) {
    return false;
  }
  if (targetDate !== undefined && !isValidPlanDate(targetDate)) {
    return false;
  }
  return startDate === undefined || targetDate === undefined || startDate <= targetDate;
}

/** The `Europe/Oslo` calendar date (`YYYY-MM-DD`) of an injected instant. */
export function planningToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PLANNING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Derived, never stored: the target date has passed and the plan is not
 * completed. `today` is injected by the server — never client-supplied.
 */
export function isOverdue(
  plan: { targetDate?: string; status: string },
  today: string,
): boolean {
  return plan.targetDate !== undefined && plan.status !== "completed" && plan.targetDate < today;
}

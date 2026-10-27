const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 2020;
const MAX_YEAR = 2100;

/**
 * `plannedFor` (SPEC BR-6): a plain `YYYY-MM-DD` real calendar date, year 2020–2100. No time, no timezone.
 * Past and future dates are valid; there is no overdue concept. Same rule as D1's target date, kept as a local
 * copy so D2 does not import D1 domain code.
 */
export function isValidPlanDate(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = DATE_PATTERN.exec(value);
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
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export type NormalizePlannedForResult = { ok: true; value: string | null } | { ok: false };

/** `null` or an absent value means no planned date. Any other value must be a valid plan date. */
export function normalizePlannedFor(input: unknown): NormalizePlannedForResult {
  if (input === null || input === undefined) {
    return { ok: true, value: null };
  }
  if (isValidPlanDate(input)) {
    return { ok: true, value: input };
  }
  return { ok: false };
}

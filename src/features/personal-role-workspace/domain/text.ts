/**
 * Field rules shared by responsibilities and achievements (SPEC BR-10…BR-20, "Data shapes"). Every parser returns a
 * result, never throws, and never repairs: an invalid value is rejected (or, for a stored record, makes it malformed).
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false };
const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = <T>(): Parsed<T> => ({ ok: false });

/** Any Unicode control character: rejected in single-line fields. */
const CONTROL = /\p{Cc}/u;
/** Control characters other than tab, line feed and carriage return: rejected in free text. */
const NON_TEXT_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const codePointCount = (value: string): number => Array.from(value).length;

/** Single-line, required, trimmed title. */
export function parseTitle(value: unknown, max: number): Parsed<string> {
  if (typeof value !== "string") return fail();
  const trimmed = value.trim();
  if (trimmed.length === 0 || CONTROL.test(trimmed) || codePointCount(trimmed) > max) return fail();
  return ok(trimmed);
}

/** Multi-line, required, trimmed text (achievement description). */
export function parseRequiredText(value: unknown, max: number): Parsed<string> {
  if (typeof value !== "string") return fail();
  const trimmed = value.trim();
  if (trimmed.length === 0 || NON_TEXT_CONTROL.test(trimmed) || codePointCount(trimmed) > max) return fail();
  return ok(trimmed);
}

/** Optional free text: `null` or an empty string is absent (`null`). */
export function parseOptionalText(value: unknown, max: number): Parsed<string | null> {
  if (value === null) return ok(null);
  if (typeof value !== "string") return fail();
  const trimmed = value.trim();
  if (trimmed.length === 0) return ok(null);
  if (NON_TEXT_CONTROL.test(trimmed) || codePointCount(trimmed) > max) return fail();
  return ok(trimmed);
}

/** `YYYY-MM-DD`, a real calendar date. `null` is absent. */
export function parseOptionalDate(value: unknown): Parsed<string | null> {
  if (value === null) return ok(null);
  if (typeof value !== "string") return fail();
  const match = DATE_PATTERN.exec(value);
  if (!match) return fail();
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? ok(value) : fail();
}

/** `end` must not be before `start` when both are set (BR-13). */
export function datesInOrder(start: string | null, end: string | null): boolean {
  return start === null || end === null || start <= end;
}

/** Up to `max` unique addressable ids. Order is kept; duplicates and malformed ids are rejected. */
export function parseIdList(value: unknown, max: number, isValidId: (id: unknown) => id is string): Parsed<string[]> {
  if (!Array.isArray(value) || value.length > max) return fail();
  const seen = new Set<string>();
  for (const item of value) {
    if (!isValidId(item) || seen.has(item)) return fail();
    seen.add(item);
  }
  return ok([...seen]);
}

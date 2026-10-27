/**
 * Shared primitives for the stored-shape parsers (SPEC BR-51, BR-34). Pure: no Firebase, no clock, no
 * environment, no `lib/encryption` import (that module is server-only and reads `process.env`).
 *
 * Stored documents reach these parsers after the persistence adapter has mapped top-level Firestore
 * `Timestamp`s to `Date` (the D1 pattern, see `personal-goals/server/goal-store-types.ts`). Decrypted payload
 * JSON has no `Date`, so its instants are canonical ISO-8601 strings.
 */

/** Plain object in the strict sense: a literal or `Object.create(null)`. Rejects arrays, `Date`s and class instances. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Exact key set: the object's own keys (including symbol and non-enumerable keys) are exactly the listed keys, and
 * each is a data property with a defined value. Descriptors are read, never values, so a getter is never invoked.
 * Accessor properties, inherited keys, symbols, extra keys, absent keys and explicit `undefined` all fail. Firestore
 * never returns `undefined`, so `undefined` is treated as absent. Optional values are stored as `null`, never omitted.
 */
export function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  if (Reflect.ownKeys(value).length !== keys.length) {
    return false;
  }
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor && descriptor.value !== undefined;
  });
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** A stored instant: a valid `Date` (the persistence adapter's mapping of a Firestore `Timestamp`). */
export function isStoredDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * A canonical ISO-8601 instant as written by `Date.prototype.toISOString()`, for example
 * `2026-10-14T08:30:00.000Z`. Any other spelling (offset, missing milliseconds, date only) is rejected, so
 * the stored text round-trips exactly.
 */
export function parseCanonicalInstant(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    return null;
  }
  return date;
}

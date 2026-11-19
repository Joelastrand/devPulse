/**
 * Client-side search helpers for already-loaded lists (team, member, role, survey and challenge admin lists). Filtering is
 * local and needs no request. Callers pass only the fields they are authorized to show. Never pass identifiers or
 * hidden fields.
 */

/** Case-insensitive, whitespace-tolerant form of a search string or searched value. */
export function normalizeSearchText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("nb-NO");
}

/** An empty query matches everything. Otherwise any of the given fields may contain the query. */
export function matchesSearchQuery(query: string, fields: ReadonlyArray<string | null>): boolean {
  const needle = normalizeSearchText(query);
  if (needle === "") return true;
  return fields.some((field) => field !== null && normalizeSearchText(field).includes(needle));
}

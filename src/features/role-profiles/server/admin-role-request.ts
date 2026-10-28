const BEARER_PATTERN = /^Bearer (.+)$/;
const ROLE_FIELDS = ["name", "description", "expectations"];

/** The bearer token from an `Authorization` header, or `""` (the operation then refuses as unauthenticated). */
export function extractBearerToken(header: string | null): string {
  if (!header) return "";
  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

/** A JSON object body, or `undefined` for any other shape (arrays and scalars included). */
export function objectBody(body: unknown): Record<string, unknown> | undefined {
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : undefined;
}

/**
 * Copies only the role fields that are present in the body. Nothing else, such as a uid or an audit field, reaches an
 * operation, and an absent field stays absent (an empty PATCH is still detected as empty).
 */
export function pickRoleFields(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(ROLE_FIELDS.filter((field) => field in record).map((field) => [field, record[field]]));
}

import "server-only";

const BEARER_PATTERN = /^Bearer (.+)$/;

/** Bearer token from an Authorization header, or `""` (which the auth layer refuses as unauthenticated). */
export function extractBearerToken(header: string | null): string {
  if (!header) return "";
  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

/** Public error code → HTTP status for team system writes. Codes only, never raw error text. */
export const WRITE_STATUS: Record<string, number> = {
  unauthenticated: 401,
  erasure_in_progress: 403,
  auth_unavailable: 503,
  forbidden: 403,
  team_disabled: 400,
  invalid_request: 400,
  invalid_input: 400,
  invalid_knowledge: 400,
  not_found: 404,
  limit_reached: 409,
  persistence_failed: 500,
};

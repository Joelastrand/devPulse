import "server-only";

const BEARER_PATTERN = /^Bearer (.+)$/;

/** Bearer token from an Authorization header, or `""` (refused as unauthenticated by the auth layer). */
export function extractBearerToken(header: string | null): string {
  if (!header) return "";
  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

/** Unparsable JSON yields `undefined`, which the gateways refuse as `invalid_request`. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

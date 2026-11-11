import "server-only";
import { NextResponse } from "next/server";
import { authRefusalStatus, isAuthRefusal } from "../../auth/server/auth-refusal";

const BEARER_PATTERN = /^Bearer (.+)$/;

/** Bearer token from an Authorization header, or `""` (refused as unauthenticated by the auth layer). */
export function extractBearerToken(header: string | null): string {
  if (!header) return "";
  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

/** Unparsable JSON yields `undefined`, which the operations refuse as `invalid_request`. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** Public error code → HTTP status. Codes only, never raw error text. */
const TEAM_SKILL_STATUS: Record<string, number> = {
  invalid_request: 400,
  invalid_input: 400,
  skill_unavailable: 400,
  team_disabled: 400,
  forbidden: 403,
  not_found: 404,
  limit_reached: 409,
  duplicate_name: 409,
  assessment_unreadable: 409,
  read_failed: 500,
  persistence_failed: 500,
};

export function teamSkillErrorResponse(error: string): NextResponse {
  const status = isAuthRefusal(error) ? authRefusalStatus(error) : (TEAM_SKILL_STATUS[error] ?? 500);
  return NextResponse.json({ error }, { status });
}

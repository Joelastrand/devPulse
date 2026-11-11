import "server-only";
import { NextResponse } from "next/server";
import { authRefusalStatus, isAuthRefusal } from "../../auth/server/auth-refusal";

/** Public error code → HTTP status. Codes only, never raw error text. */
const COMPETENCE_PLAN_STATUS: Record<string, number> = {
  invalid_request: 400,
  invalid_input: 400,
  team_disabled: 400,
  not_found: 404,
  limit_reached: 409,
  forbidden: 403,
  read_failed: 500,
  persistence_failed: 500,
};

export function competencePlanErrorResponse(error: string, issues?: readonly string[]): NextResponse {
  const status = isAuthRefusal(error) ? authRefusalStatus(error) : (COMPETENCE_PLAN_STATUS[error] ?? 500);
  return NextResponse.json(issues ? { error, issues } : { error }, { status });
}

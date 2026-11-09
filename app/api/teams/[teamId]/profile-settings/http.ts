import { NextResponse } from "next/server";
import { authRefusalStatus, isAuthRefusal } from "../../../../../src/features/auth/server/auth-refusal";

const NO_STORE = { "Cache-Control": "no-store" };

const STATUS: Record<string, number> = {
  invalid_request: 400,
  invalid_input: 400,
  forbidden: 403,
  team_disabled: 409,
  not_found: 404,
  read_failed: 500,
  persistence_failed: 500,
};

/** Error codes only, never raw error text. Every response carries no-store. */
export function profileErrorResponse(error: string): NextResponse {
  const status = isAuthRefusal(error) ? authRefusalStatus(error) : (STATUS[error] ?? 500);
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export function noStoreJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

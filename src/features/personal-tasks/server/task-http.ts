import "server-only";
import { NextResponse } from "next/server";
import { verifyIdToken } from "../../auth/server/verify-identity";
import { type AuthRefusal, authRefusalFor, authRefusalStatus } from "../../auth/server/auth-refusal";
import type { TaskOperationError } from "./task-store-types";

const BEARER_PATTERN = /^Bearer (.+)$/;
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The verified token's uid, or the refusal. The uid is the only subject: no uid in path, query or body is ever read as
 * authority. Verification (revocation, disabled flag, NVE policy, erasure fence) is the shared gateway.
 */
export async function authenticateOwner(
  request: Request,
): Promise<{ ok: true; uid: string } | { ok: false; error: AuthRefusal }> {
  const match = BEARER_PATTERN.exec(request.headers.get("authorization") ?? "");
  const verified = await verifyIdToken(match ? match[1] : "");
  return verified.ok
    ? { ok: true, uid: verified.identity.uid }
    : { ok: false, error: authRefusalFor(verified) };
}

/** HTTP status for every task operation error. Exhaustive by type, so a new error must be classified. */
const OPERATION_STATUS: Record<TaskOperationError, number> = {
  invalid_request: 400,
  invalid_title: 400,
  invalid_description: 400,
  invalid_notes: 400,
  invalid_status: 400,
  invalid_priority: 400,
  invalid_due_date: 400,
  invalid_position: 400,
  invalid_visibility: 400,
  invalid_cursor: 400,
  not_found: 404,
  task_limit: 409,
  erasure_in_progress: 403,
  persistence_failed: 500,
};

export function operationStatus(error: TaskOperationError): number {
  return OPERATION_STATUS[error];
}

/** A JSON response that is never cached. */
export function jsonResponse(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function errorResponse(error: string, status: number): NextResponse {
  return jsonResponse({ error }, status);
}

/** A refused request: 401 for unauthenticated, 403 for erasure, 503 when verification could not be completed. */
export function authRefusalResponse(refusal: AuthRefusal): NextResponse {
  return errorResponse(refusal, authRefusalStatus(refusal));
}

/** Reads a JSON body. A missing or malformed body is `invalid_request`, never a crash. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

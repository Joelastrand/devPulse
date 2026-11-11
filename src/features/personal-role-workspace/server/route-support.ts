import "server-only";
import { verifyIdToken } from "../../auth/server/verify-identity";
import { authRefusalFor, type AuthRefusal } from "../../auth/server/auth-refusal";
import type { RecordError } from "./record-engine";

/**
 * Shared route helpers for the personal record routes. The subject is always the uid of the verified bearer token: no
 * route reads a uid from the path, the query or the body (PR-SI-1).
 */

const BEARER_PATTERN = /^Bearer (.+)$/;

export async function authenticate(request: Request): Promise<{ ok: true; uid: string } | { ok: false; error: AuthRefusal }> {
  const match = BEARER_PATTERN.exec(request.headers.get("authorization") ?? "");
  const verified = await verifyIdToken(match ? match[1] : "");
  return verified.ok ? { ok: true, uid: verified.identity.uid } : { ok: false, error: authRefusalFor(verified) };
}

/** Status for each public record error. Exhaustive by type, so a new error must be mapped deliberately. */
export const RECORD_ERROR_STATUS: Record<RecordError, number> = {
  invalid_input: 400,
  invalid_reference: 400,
  not_found: 404,
  record_limit: 409,
  record_unavailable: 409,
  payload_too_large: 413,
  persistence_failed: 500,
  erasure_in_progress: 409,
};

/** A record id in a route path. Anything not addressable is reported as not found, with no detail. */
export function recordIdParam(value: string): string | null {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value) && !/^__.*__$/.test(value) ? value : null;
}

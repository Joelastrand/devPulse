import "server-only";
import { authRefusalStatus, isAuthRefusal } from "../../auth/server/auth-refusal";
import { startOrResumeErasure, type StartErasureDeps, type StartErasureError } from "./start-erasure";

/**
 * HTTP mapping for `POST /api/me/erasure` (TASK-013). Kept out of the route file so the body contract and the status
 * mapping are testable with injected dependencies. Next route files export only HTTP methods.
 *
 * Response contract (SPEC "Start/resume contract"):
 * - 200 `{status: "in_progress", step}` or `{status: "completed"}`;
 * - 400 `{error: "invalid_request"}` for a malformed body, or `{error: "confirmation_mismatch"}`;
 * - 401 / 403 / 503 for the shared auth refusals (`unauthenticated`, `erasure_in_progress`, `auth_unavailable`);
 * - 403 `{error: "recent_auth_required"}`;
 * - 503 `{error: "erasure_unavailable"}` for a resumable operational failure and for the production-not-ready refusal.
 *
 * No body contains an email, uid, team, membership, or persisted record code.
 */

export interface ErasureHttpResponse {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
}

const BEARER_PATTERN = /^Bearer (.+)$/;

export function bearerTokenFrom(header: string | null): string {
  if (!header) return "";
  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

/** The largest body this endpoint reads. A start body is one email-sized string, so 1 KB is generous. */
export const START_ERASURE_MAX_BODY_BYTES = 1024;

/** True when the declared Content-Length exceeds the bound. Checked before the body is read. */
export function isBodyTooLarge(contentLength: string | null): boolean {
  if (contentLength === null) return false;
  const declared = Number(contentLength);
  return Number.isFinite(declared) && declared > START_ERASURE_MAX_BODY_BYTES;
}

/**
 * Parses the raw request text. An empty body is allowed (resume needs no body). Anything else must be valid JSON;
 * invalid JSON is a request error, not an operational one.
 */
export function readStartErasureBody(text: string): { ok: true; body: unknown } | { ok: false } {
  if (text.trim() === "") return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Accepts exactly `{}` or `{confirmation: string}`. Any other key, a non-object, or a non-string confirmation is rejected. */
export function parseStartErasureBody(raw: unknown): { ok: true; confirmation?: string } | { ok: false } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false };
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "confirmation") return { ok: false };
  }
  if (record.confirmation === undefined) return { ok: true };
  if (typeof record.confirmation !== "string") return { ok: false };
  return { ok: true, confirmation: record.confirmation };
}

const OPERATION_STATUS: Record<Exclude<StartErasureError, "unauthenticated" | "erasure_in_progress" | "auth_unavailable">, number> = {
  recent_auth_required: 403,
  confirmation_mismatch: 400,
  erasure_unavailable: 503,
};

export async function startErasureResponse(
  authorization: string | null,
  rawBody: unknown,
  deps: StartErasureDeps,
): Promise<ErasureHttpResponse> {
  const parsed = parseStartErasureBody(rawBody);
  if (!parsed.ok) return { status: 400, body: { error: "invalid_request" } };

  const result = await startOrResumeErasure(
    bearerTokenFrom(authorization),
    parsed.confirmation === undefined ? {} : { confirmation: parsed.confirmation },
    deps,
  );

  if (result.ok) {
    return { status: 200, body: { ...result.state } };
  }

  const status = isAuthRefusal(result.error) ? authRefusalStatus(result.error) : OPERATION_STATUS[result.error];
  return { status, body: { error: result.error } };
}

/**
 * Bounds for a reply's body (docs/features/team-forum/SPEC.md — BR-4):
 * non-empty after trimming, and between these two lengths (inclusive),
 * measured on the trimmed text.
 */
export const REPLY_BODY_MIN_LENGTH = 3;
export const REPLY_BODY_MAX_LENGTH = 2000;

export type ValidateReplyBodyResult =
  | { ok: true; body: string }
  | { ok: false; error: "invalid_input" };

/**
 * Validates and normalizes a raw, untrusted reply body (docs/features/
 * team-forum/SPEC.md — BR-4). This is the single canonical trim path for a
 * reply body — callers must use the returned `body`, not re-trim the
 * original input themselves.
 *
 * Rejects (`invalid_input`, never throws): a non-string value; a value that
 * is empty or whitespace-only after trimming; a trimmed length below
 * `REPLY_BODY_MIN_LENGTH` or above `REPLY_BODY_MAX_LENGTH`. Never truncates
 * a too-long value — an over-length input is rejected outright, not
 * silently cut down to the limit.
 */
export function validateReplyBody(input: unknown): ValidateReplyBodyResult {
  if (typeof input !== "string") {
    return { ok: false, error: "invalid_input" };
  }

  const body = input.trim();

  if (body.length < REPLY_BODY_MIN_LENGTH || body.length > REPLY_BODY_MAX_LENGTH) {
    return { ok: false, error: "invalid_input" };
  }

  return { ok: true, body };
}

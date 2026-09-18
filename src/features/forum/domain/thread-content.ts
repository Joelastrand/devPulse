/**
 * Bounds for a thread's title (docs/features/team-forum/SPEC.md — BR-3):
 * non-empty after trimming, and between these two lengths (inclusive),
 * measured on the trimmed text.
 */
export const THREAD_TITLE_MIN_LENGTH = 3;
export const THREAD_TITLE_MAX_LENGTH = 150;

/**
 * Bounds for a thread's body (docs/features/team-forum/SPEC.md — BR-3):
 * non-empty after trimming, and between these two lengths (inclusive),
 * measured on the trimmed text.
 */
export const THREAD_BODY_MIN_LENGTH = 3;
export const THREAD_BODY_MAX_LENGTH = 4000;

export type ValidateThreadTitleResult =
  | { ok: true; title: string }
  | { ok: false; error: "invalid_input" };

export type ValidateThreadBodyResult =
  | { ok: true; body: string }
  | { ok: false; error: "invalid_input" };

/**
 * Validates and normalizes a raw, untrusted thread title (docs/features/
 * team-forum/SPEC.md — BR-3). This is the single canonical trim path for a
 * thread title — callers must use the returned `title`, not re-trim the
 * original input themselves.
 *
 * Rejects (`invalid_input`, never throws): a non-string value; a value that
 * is empty or whitespace-only after trimming; a trimmed length below
 * `THREAD_TITLE_MIN_LENGTH` or above `THREAD_TITLE_MAX_LENGTH`. Never
 * truncates a too-long value — an over-length input is rejected outright,
 * not silently cut down to the limit.
 *
 * Kept independent from `validateThreadBody` (not one combined validator)
 * so a title-only or body-only validation error can be reported distinctly.
 */
export function validateThreadTitle(input: unknown): ValidateThreadTitleResult {
  if (typeof input !== "string") {
    return { ok: false, error: "invalid_input" };
  }

  const title = input.trim();

  if (title.length < THREAD_TITLE_MIN_LENGTH || title.length > THREAD_TITLE_MAX_LENGTH) {
    return { ok: false, error: "invalid_input" };
  }

  return { ok: true, title };
}

/**
 * Validates and normalizes a raw, untrusted thread body (docs/features/
 * team-forum/SPEC.md — BR-3). Same trimming/rejection contract as
 * `validateThreadTitle`, applied to `THREAD_BODY_MIN_LENGTH`/
 * `THREAD_BODY_MAX_LENGTH` instead.
 */
export function validateThreadBody(input: unknown): ValidateThreadBodyResult {
  if (typeof input !== "string") {
    return { ok: false, error: "invalid_input" };
  }

  const body = input.trim();

  if (body.length < THREAD_BODY_MIN_LENGTH || body.length > THREAD_BODY_MAX_LENGTH) {
    return { ok: false, error: "invalid_input" };
  }

  return { ok: true, body };
}

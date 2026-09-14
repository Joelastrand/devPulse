/**
 * Bounds for a challenge's free-text body (docs/features/
 * anonymous-challenges/SPEC.md — BR-3): non-empty after trimming, and
 * between these two lengths (inclusive), measured on the trimmed text.
 */
export const CHALLENGE_TEXT_MIN_LENGTH = 3;
export const CHALLENGE_TEXT_MAX_LENGTH = 2000;

export type ValidateChallengeTextResult =
  | { ok: true; text: string }
  | { ok: false; error: "invalid_input" };

/**
 * Validates and normalizes a raw, untrusted challenge submission body
 * (docs/features/anonymous-challenges/SPEC.md — BR-3). This is the single
 * canonical trim path for challenge text — callers must use the returned
 * `text`, not re-trim the original input themselves, so later persistence/
 * encryption code never reimplements this rule.
 *
 * Rejects (`invalid_input`, never throws): a non-string value; a value
 * that is empty or whitespace-only after trimming; a trimmed length below
 * `CHALLENGE_TEXT_MIN_LENGTH` or above `CHALLENGE_TEXT_MAX_LENGTH`. Never
 * truncates a too-long value — an over-length input is rejected outright,
 * not silently cut down to the limit.
 *
 * Only the free-text body is validated here — `teamId` is always a
 * trusted server route scope, resolved and validated by later tasks, never
 * treated as untrusted request data by this module.
 */
export function validateChallengeText(input: unknown): ValidateChallengeTextResult {
  if (typeof input !== "string") {
    return { ok: false, error: "invalid_input" };
  }

  const text = input.trim();

  if (text.length < CHALLENGE_TEXT_MIN_LENGTH || text.length > CHALLENGE_TEXT_MAX_LENGTH) {
    return { ok: false, error: "invalid_input" };
  }

  return { ok: true, text };
}

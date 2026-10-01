/** Display-name length bounds, counted in Unicode code points (docs/features/member-identity-and-team-roles/SPEC.md — BR-4). */
export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 50;

export type NormalizeDisplayNameResult =
  | { ok: true; displayName: string }
  | { ok: false };

// Control, format (zero-width, bidi overrides/isolates), private-use,
// surrogate and unassigned code points, plus line/paragraph separators.
const FORBIDDEN_CODE_POINTS = /[\p{C}\p{Zl}\p{Zp}]/u;
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const WHITESPACE_RUN = /\s+/g;

/**
 * Normalises then validates a candidate display name (SPEC BR-4). Order:
 * NFC → trim → reject forbidden code points → collapse internal whitespace
 * runs to one space → length (code points, not UTF-16 units) and
 * letter-or-number check. The returned `displayName` is the value that must
 * be stored and echoed back. A display name is presentation only: never an
 * identifier, a uniqueness key or authorization input (BR-5, BR-6), so no
 * uniqueness, reserved-word or e-mail-shape rule exists here.
 *
 * Forbidden code points are rejected *after* the edge trim (so a trailing
 * newline is harmless) and *before* the collapse (so an inner newline or tab
 * is rejected rather than silently turned into a space).
 */
export function normalizeDisplayName(input: unknown): NormalizeDisplayNameResult {
  if (typeof input !== "string") {
    return { ok: false };
  }

  const trimmed = input.normalize("NFC").trim();
  if (FORBIDDEN_CODE_POINTS.test(trimmed)) {
    return { ok: false };
  }

  const displayName = trimmed.replace(WHITESPACE_RUN, " ");
  const length = Array.from(displayName).length;
  if (length < DISPLAY_NAME_MIN_LENGTH || length > DISPLAY_NAME_MAX_LENGTH) {
    return { ok: false };
  }
  if (!LETTER_OR_NUMBER.test(displayName)) {
    return { ok: false };
  }

  return { ok: true, displayName };
}

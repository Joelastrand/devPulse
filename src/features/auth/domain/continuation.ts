/**
 * Validates and resolves the `continue` query parameter accepted by
 * `/sign-in` as a post-authentication redirect target
 * (docs/features/managed-surveys/SPEC.md — BR-40, "The sign-in flow needs
 * a continuation target").
 *
 * This is a narrow allow-list, not a same-origin/relative-URL check: the
 * only accepted shape is exactly `/survey/{surveyId}`. Anything else — an
 * absolute or protocol-relative URL, a `javascript:`/`data:` value, a
 * different internal route (`/admin/...`, `/teams/...`, `/sign-in/...`),
 * path traversal, an extra path segment, an empty survey id, or any
 * embedded `?`/`#`/`/` character inside the id itself — falls back to the
 * existing default (`/teams`) rather than being followed.
 *
 * The input is treated as the single, already-decoded value of one query
 * parameter and is never decoded again here, so a double-encoded value
 * (e.g. `%252Fsurvey%252Fabc`) never matches the pattern below — it still
 * contains a literal `%` after the one decode Next.js already performed,
 * which this pattern excludes.
 */

const SURVEY_CONTINUATION_PATTERN = /^\/survey\/[A-Za-z0-9_-]+$/;

export const DEFAULT_SIGN_IN_PATH = "/teams";

export interface SignInDestination {
  /** The path to send the user to after a successful sign-in. */
  path: string;
  /** True only when `path` is a validated `/survey/{surveyId}` continuation. */
  isSurveyContinuation: boolean;
}

export const DEFAULT_SIGN_IN_DESTINATION: SignInDestination = {
  path: DEFAULT_SIGN_IN_PATH,
  isSurveyContinuation: false,
};

/** Exposed for tests and for anything that needs the raw allow-list check. */
export function isValidSurveyContinuationPath(path: string): boolean {
  return SURVEY_CONTINUATION_PATTERN.test(path);
}

/**
 * Resolves the raw `continue` query value (as Next.js's `searchParams`
 * hands it over — a string, repeated-key array, or absent) to a safe
 * post-sign-in destination. Never throws; any unrecognized shape falls
 * back to the `/teams` default.
 */
export function resolveSignInDestination(
  continuation: string | string[] | null | undefined,
): SignInDestination {
  const value = Array.isArray(continuation) ? continuation[0] : continuation;

  if (typeof value === "string" && isValidSurveyContinuationPath(value)) {
    return { path: value, isSurveyContinuation: true };
  }

  return DEFAULT_SIGN_IN_DESTINATION;
}

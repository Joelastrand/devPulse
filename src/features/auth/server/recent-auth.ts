/**
 * Recent-authentication check (account-erasure TASK-010, BR-3, AE-SI-10). Pure: the clock and the window are arguments.
 * The window is passed in by the caller because auth must not import account-erasure; erasure passes its own constant.
 *
 * `authTimeSeconds` is the token's `auth_time` (seconds since epoch) as verified by Firebase. A missing or non-finite
 * value is "not recent". A value later than `nowSeconds` is "not recent" too: a token from the future cannot be
 * verified as fresh.
 */
export function isRecentAuth(
  authTimeSeconds: number | undefined,
  nowSeconds: number,
  windowSeconds: number,
): boolean {
  if (authTimeSeconds === undefined || !Number.isFinite(authTimeSeconds)) return false;
  if (authTimeSeconds > nowSeconds) return false;
  return nowSeconds - authTimeSeconds <= windowSeconds;
}

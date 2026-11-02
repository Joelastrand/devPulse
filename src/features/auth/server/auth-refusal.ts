import "server-only";

/**
 * The refusal a protected operation returns when the caller's token does not establish an identity (TASK-009 caller
 * propagation). A genuine rejection keeps the existing `unauthenticated` code, so service contracts for an invalid token
 * are unchanged. The two fence outcomes keep their own codes and never collapse into `unauthenticated` (D-AUTHFAIL).
 *
 * Kept apart from `verify-identity.ts` so route and service code can import the mapping without importing the verifier.
 */
export type AuthRefusal = "unauthenticated" | "erasure_in_progress" | "auth_unavailable";

/** A failed `verifyIdToken` result, reduced to the codes that map to a refusal. */
export function authRefusalFor(failure: {
  readonly error: "invalid_token" | "erasure_in_progress" | "auth_unavailable";
}): AuthRefusal {
  return failure.error === "invalid_token" ? "unauthenticated" : failure.error;
}

export function isAuthRefusal(error: string): error is AuthRefusal {
  return error === "unauthenticated" || error === "erasure_in_progress" || error === "auth_unavailable";
}

/** HTTP status for an auth refusal: 401 genuine rejection, 403 erasure in progress, 503 auth unavailable (D-AUTHFAIL). */
export function authRefusalStatus(refusal: AuthRefusal): 401 | 403 | 503 {
  if (refusal === "erasure_in_progress") return 403;
  if (refusal === "auth_unavailable") return 503;
  return 401;
}

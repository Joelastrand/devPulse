import "server-only";
import { authRefusalStatus, isAuthRefusal } from "../../auth/server/auth-refusal";
import type { UserManagementError } from "./user-management";

/**
 * HTTP mapping for the superadmin user-management routes. One tested function keeps the status contract in one place.
 * Response bodies carry only fixed error codes and the account fields the operator screen needs.
 */
export function userManagementErrorStatus(error: UserManagementError): number {
  if (isAuthRefusal(error)) return authRefusalStatus(error);
  switch (error) {
    case "forbidden":
      return 403;
    case "invalid_input":
    case "confirmation_required":
      return 400;
    case "user_not_found":
      return 404;
    case "self_action_refused":
    case "target_is_superadmin":
      return 409;
    case "persistence_failed":
      return 500;
  }
}

/** Reads the `limit`, `pageToken` and `email` query parameters as untrusted strings. Validation happens in the operation. */
export function listQueryFrom(url: URL): { limit?: unknown; pageToken?: unknown; email?: unknown } {
  const limit = url.searchParams.get("limit");
  return {
    limit: limit === null ? undefined : Number(limit),
    pageToken: url.searchParams.get("pageToken") ?? undefined,
    email: url.searchParams.get("email") ?? undefined,
  };
}

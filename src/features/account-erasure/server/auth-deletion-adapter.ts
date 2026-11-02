import "server-only";
import { getAdminAuth } from "../../../lib/firebase/admin";
import type { AuthDeleteResult, AuthDeletionPort } from "./auth-deletion";

/**
 * Production Auth deletion port (TASK-037). Wraps `getAdminAuth().deleteUser`. `auth/user-not-found` is the retry-safe
 * "already absent" result. Every other failure is `unavailable`, and the raw SDK error text is never returned or logged.
 */
export function createAdminAuthDeletionPort(): AuthDeletionPort {
  return {
    async deleteUser(uid): Promise<AuthDeleteResult> {
      try {
        await getAdminAuth().deleteUser(uid);
        return "deleted";
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === "auth/user-not-found") return "not_found";
        return "unavailable";
      }
    },
  };
}

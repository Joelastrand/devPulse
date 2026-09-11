import "server-only";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import { normalizeEmail } from "./normalize-email";

/**
 * Server-only, deploy-time allow-list of app-admin email addresses, read
 * from `APP_ADMIN_EMAILS` (comma-separated) at call time. Never exposed to
 * client code (docs/features/team-management/SPEC.md — BR-36).
 */
function getAdminAllowListFromEnv(): readonly string[] {
  const raw = process.env.APP_ADMIN_EMAILS ?? "";

  return raw
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .filter((entry) => entry.length > 0);
}

export interface IsAppAdminDeps {
  allowList?: readonly string[];
}

/**
 * Determines app-admin status solely from the caller's already-verified
 * identity (`uid`/`email`/`emailVerified`, established by `verifyIdToken`
 * — including its revocation check — never re-verified here) and the
 * server-only admin allow-list. Requires `emailVerified` in addition to an
 * allow-list match; never trusts any other field on `identity` as
 * authorization evidence (docs/features/team-management/SPEC.md — BR-5,
 * BR-6).
 */
export function isAppAdmin(
  identity: VerifiedIdentity,
  deps: IsAppAdminDeps = {},
): boolean {
  if (!identity.emailVerified) {
    return false;
  }

  const allowList = deps.allowList ?? getAdminAllowListFromEnv();
  return allowList
    .map((entry) => normalizeEmail(entry))
    .includes(normalizeEmail(identity.email));
}

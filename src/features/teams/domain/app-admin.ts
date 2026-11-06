import "server-only";
import { type VerifiedIdentity } from "../../auth/server/verify-identity";
import { readSuperadminActive } from "../../superadmins/server/superadmin-policy";

/**
 * Injectable superadmin lookup. Production reads the Firebase-backed registry (`superadmins/{uid}`) on every call; tests
 * inject a fake. There is no environment-variable or email allow-list path any more (docs/SECURITY.md, superadmin
 * section): `APP_ADMIN_EMAILS` is no longer read by this module.
 */
export interface IsAppAdminDeps {
  isSuperadmin?: (uid: string) => Promise<boolean>;
}

/**
 * Determines superadmin (app-admin) status from the caller's already-verified identity: the UID must have an active
 * registry record, and the verified-email requirement is kept (docs/features/team-management/SPEC.md — BR-5, BR-6).
 * The email address is never an authorization key. Only `uid` and `emailVerified` from `identity` are trusted.
 *
 * Async: every caller must `await` it. A registry read failure rejects, so the caller fails closed.
 */
export async function isAppAdmin(identity: VerifiedIdentity, deps: IsAppAdminDeps = {}): Promise<boolean> {
  if (!identity.emailVerified) {
    return false;
  }

  const isSuperadmin = deps.isSuperadmin ?? readSuperadminActive;
  return isSuperadmin(identity.uid);
}

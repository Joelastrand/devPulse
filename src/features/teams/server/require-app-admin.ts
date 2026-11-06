import "server-only";
import { type VerifiedIdentity, verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { isAppAdmin, type IsAppAdminDeps } from "../domain/app-admin";
import { type AuthRefusal, authRefusalFor } from "../../auth/server/auth-refusal";

export type RequireAppAdminResult =
  | { ok: true; identity: VerifiedIdentity }
  | { ok: false; error: AuthRefusal | "forbidden" };

export interface RequireAppAdminDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  readFence?: VerifyIdTokenDeps["readFence"];
  isSuperadmin?: IsAppAdminDeps["isSuperadmin"];
}

/**
 * Shared authorization preamble for every admin-only server operation: verifies the ID token (revocation-checked, via
 * `verifyIdToken`), then checks the Firebase-backed superadmin registry through `isAppAdmin`, read on every call. A
 * registry read failure is `auth_unavailable` (fail closed), never `forbidden` and never a grant.
 * Intentionally narrow: only the admin/non-admin gate. `authorizeTeamAccess` is the separate team-scoped decision.
 */
export async function requireAppAdmin(idToken: string, deps: RequireAppAdminDeps = {}): Promise<RequireAppAdminResult> {
  const verified = await verifyIdToken(idToken, {
    verifyToken: deps.verifyToken,
    readFence: deps.readFence,
  });
  if (!verified.ok) {
    return { ok: false, error: authRefusalFor(verified) };
  }

  let admin: boolean;
  try {
    admin = await isAppAdmin(verified.identity, { isSuperadmin: deps.isSuperadmin });
  } catch {
    return { ok: false, error: "auth_unavailable" };
  }
  if (!admin) {
    return { ok: false, error: "forbidden" };
  }

  return { ok: true, identity: verified.identity };
}

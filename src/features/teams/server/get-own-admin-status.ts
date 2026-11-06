import "server-only";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { isAppAdmin, type IsAppAdminDeps } from "../domain/app-admin";
import { type AuthRefusal, authRefusalFor } from "../../auth/server/auth-refusal";

export type GetOwnAdminStatusResult =
  | { ok: true; isAdmin: boolean }
  | { ok: false; error: AuthRefusal };

export interface GetOwnAdminStatusDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  isSuperadmin?: IsAppAdminDeps["isSuperadmin"];
}

/**
 * Returns exactly the caller's own `isAdmin` boolean, read from the Firebase superadmin registry on this request. Never
 * the registry contents, another identity's status, or any team data. An unauthenticated caller is rejected, and a
 * registry read failure is `auth_unavailable`, never a `false` that could be mistaken for a verified answer.
 */
export async function getOwnAdminStatus(idToken: string, deps: GetOwnAdminStatusDeps = {}): Promise<GetOwnAdminStatusResult> {
  const verified = await verifyIdToken(idToken, {
    verifyToken: deps.verifyToken,
  });
  if (!verified.ok) {
    return { ok: false, error: authRefusalFor(verified) };
  }

  try {
    const isAdmin = await isAppAdmin(verified.identity, { isSuperadmin: deps.isSuperadmin });
    return { ok: true, isAdmin };
  } catch {
    return { ok: false, error: "auth_unavailable" };
  }
}

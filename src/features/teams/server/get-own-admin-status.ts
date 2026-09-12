import "server-only";
import {
  verifyIdToken,
  type VerifyIdTokenDeps,
} from "../../auth/server/verify-identity";
import { isAppAdmin, type IsAppAdminDeps } from "../domain/app-admin";

export type GetOwnAdminStatusResult =
  | { ok: true; isAdmin: boolean }
  | { ok: false; error: "unauthenticated" };

export interface GetOwnAdminStatusDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
}

/**
 * Returns exactly the caller's own `isAdmin` boolean — never the allow-
 * list, another identity's status, or any team/result data
 * (docs/features/team-management/SPEC.md BR-36;
 * docs/features/product-ux-shell/SPEC.md → Architecture decisions → "New
 * minimal server read"). Reuses `verifyIdToken` (revocation-checked) +
 * `isAppAdmin` exactly as `requireAppAdmin` does, but composed
 * differently: unlike `requireAppAdmin`, a verified caller who isn't an
 * admin is not rejected — they get a successful `{isAdmin: false}` result,
 * since every caller is authorized to learn their own status. Only an
 * unauthenticated/invalid token is rejected, with a generic error that is
 * never confusable with a verified "false". Performs no Firestore read.
 */
export async function getOwnAdminStatus(
  idToken: string,
  deps: GetOwnAdminStatusDeps = {},
): Promise<GetOwnAdminStatusResult> {
  const verified = await verifyIdToken(idToken, {
    verifyToken: deps.verifyToken,
  });
  if (!verified.ok) {
    return { ok: false, error: "unauthenticated" };
  }

  return {
    ok: true,
    isAdmin: isAppAdmin(verified.identity, { allowList: deps.allowList }),
  };
}

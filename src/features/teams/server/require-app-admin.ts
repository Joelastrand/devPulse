import "server-only";
import {
  verifyIdToken,
  type VerifiedIdentity,
  type VerifyIdTokenDeps,
} from "../../auth/server/verify-identity";
import { isAppAdmin, type IsAppAdminDeps } from "../domain/app-admin";

export type RequireAppAdminResult =
  | { ok: true; identity: VerifiedIdentity }
  | { ok: false; error: "unauthenticated" | "forbidden" };

export interface RequireAppAdminDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
}

/**
 * Shared authorization preamble for every admin-only server operation:
 * verifies the ID token (revocation-checked, via `verifyIdToken` —
 * unchanged) then checks `isAppAdmin`. Extracted from the identical
 * preamble duplicated across `create-team.ts`, `set-team-status.ts`, and
 * `list-teams.ts` once TASK-002 added two more admin-gated operations.
 * Intentionally narrow: only the admin/non-admin gate, not a general
 * auth framework — `authorizeTeamAccess` (admin/member/denied) is a
 * separate function for the broader team-scoped authorization decision.
 */
export async function requireAppAdmin(
  idToken: string,
  deps: RequireAppAdminDeps = {},
): Promise<RequireAppAdminResult> {
  const verified = await verifyIdToken(idToken, {
    verifyToken: deps.verifyToken,
  });
  if (!verified.ok) {
    return { ok: false, error: "unauthenticated" };
  }

  if (!isAppAdmin(verified.identity, { allowList: deps.allowList })) {
    return { ok: false, error: "forbidden" };
  }

  return { ok: true, identity: verified.identity };
}

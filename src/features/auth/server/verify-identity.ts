import "server-only";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getAdminAuth } from "../../../lib/firebase/admin";

/** The caller's identity as established by a verified Firebase ID token. */
export interface VerifiedIdentity {
  uid: string;
  email: string;
  emailVerified: boolean;
}

export type VerifyIdTokenResult =
  | { ok: true; identity: VerifiedIdentity }
  | { ok: false; error: "invalid_token" };

export interface VerifyIdTokenDeps {
  verifyToken?: (token: string) => Promise<DecodedIdToken>;
}

/**
 * `checkRevoked: true` makes this call also reject a token whose session has
 * since been revoked (e.g. password change, account disable) even though the
 * token itself hasn't expired yet — without it, such a token would stay
 * valid for its full remaining lifetime (found in security-review).
 */
function defaultVerifyToken(token: string): Promise<DecodedIdToken> {
  return getAdminAuth().verifyIdToken(token, true);
}

/**
 * Verifies a Firebase ID token server-side and extracts the caller's
 * identity. This is the only trusted source of `email`/`emailVerified` for
 * protected requests (TASK-002/TASK-004) — a client-asserted value is never
 * accepted as authorization evidence (`.claude/rules/security.md`).
 */
export async function verifyIdToken(
  token: string,
  deps: VerifyIdTokenDeps = {},
): Promise<VerifyIdTokenResult> {
  if (!token) {
    return { ok: false, error: "invalid_token" };
  }

  const verifyToken = deps.verifyToken ?? defaultVerifyToken;

  let decoded: DecodedIdToken;
  try {
    decoded = await verifyToken(token);
  } catch {
    return { ok: false, error: "invalid_token" };
  }

  if (!decoded.email) {
    return { ok: false, error: "invalid_token" };
  }

  return {
    ok: true,
    identity: {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified === true,
    },
  };
}

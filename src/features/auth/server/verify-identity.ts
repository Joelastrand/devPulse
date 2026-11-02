import "server-only";
import { type ErasureResumeCapability, isErasureResumeCapability } from "./erasure-resume-capability";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getAdminAuth } from "../../../lib/firebase/admin";
import {
  readErasureFenceFromFirestore,
  type ErasureFenceState,
  type ReadErasureFence,
} from "./erasure-fence";

/** The caller's identity as established by a verified Firebase ID token. */
export interface VerifiedIdentity {
  uid: string;
  email: string;
  emailVerified: boolean;
  /** The token's `auth_time` in seconds. Present only when the decoded token carries one (account-erasure TASK-010). */
  verifiedAuthTime?: number;
}

/**
 * `invalid_token`: genuine rejection (missing, invalid, revoked, disabled token, or a record that ended erasure). HTTP 401.
 * `erasure_in_progress`: the uid's erasure is running; every protected operation except the erasure endpoint refuses.
 * `auth_unavailable`: Auth or the fence record could not be established, so the request fails closed. HTTP 503. Never
 * reported as `invalid_token` and never a route to protected data (D-AUTHFAIL).
 */
export type VerifyIdTokenResult =
  | { ok: true; identity: VerifiedIdentity }
  | { ok: false; error: "invalid_token" | "erasure_in_progress" | "auth_unavailable" };

export type VerifyIdTokenFailure = Extract<VerifyIdTokenResult, { ok: false }>["error"];

/**
 * The refusal a protected service returns when verification does not establish an identity (TASK-009 caller
 * propagation). A genuine rejection keeps the existing `unauthenticated` code, so service contracts for an invalid
 * token are unchanged; the two fence outcomes keep their own codes and never collapse into `unauthenticated`.
 */
export interface VerifyIdTokenDeps {
  verifyToken?: (token: string) => Promise<DecodedIdToken>;
  readFence?: ReadErasureFence;
  /**
   * Narrow exception for the erasure start/resume endpoint's in-progress path only (SPEC "Start/resume contract"). It is an
   * opaque capability minted by `erasure-resume-capability.ts`, not a boolean, and only the start/resume operation may obtain one.
   */
  allowDuringErasure?: ErasureResumeCapability;
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
 * Firebase Admin error codes that mean the Auth service or the network is unavailable, not that the token is bad. The
 * installed firebase-admin 14.3.0 defines these codes; the `auth/` or `app/` prefix is added by its error classes.
 */
const AUTH_INFRASTRUCTURE_CODES = new Set(["internal-error", "network-error", "network-timeout", "service-unavailable"]);

function isAuthInfrastructureFailure(error: unknown): boolean {
  const code: unknown = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  if (typeof code !== "string") return false;
  const bare = code.replace(/^(auth|app)\//, "");
  return AUTH_INFRASTRUCTURE_CODES.has(bare);
}

/** A fence read that fails (a Firestore error) fails closed as `auth_unavailable`; it never reads as "no record". */
async function readFenceOrUnavailable(
  readFence: ReadErasureFence,
  uid: string,
): Promise<ErasureFenceState | "unavailable"> {
  try {
    return await readFence(uid);
  } catch {
    return "unavailable";
  }
}

/**
 * Verifies a Firebase ID token server-side and extracts the caller's
 * identity. This is the only trusted source of `email`/`emailVerified` for
 * protected requests (TASK-002/TASK-004) — a client-asserted value is never
 * accepted as authorization evidence (`.claude/rules/security.md`).
 *
 * The erasure fence (TASK-009, BR-4(a)) runs here, before any caller's role logic, so an admin or lead cannot bypass it.
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
  } catch (error) {
    return { ok: false, error: isAuthInfrastructureFailure(error) ? "auth_unavailable" : "invalid_token" };
  }

  if (!decoded.email) {
    return { ok: false, error: "invalid_token" };
  }

  const fence = await readFenceOrUnavailable(deps.readFence ?? readErasureFenceFromFirestore, decoded.uid);
  if (fence === "unavailable" || fence.kind === "malformed") {
    return { ok: false, error: "auth_unavailable" };
  }
  if (fence.kind === "terminal") {
    return { ok: false, error: "invalid_token" };
  }
  if (fence.kind === "in_progress" && !isErasureResumeCapability(deps.allowDuringErasure)) {
    return { ok: false, error: "erasure_in_progress" };
  }

  return {
    ok: true,
    identity: {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified === true,
      ...(typeof decoded.auth_time === "number" ? { verifiedAuthTime: decoded.auth_time } : {}),
    },
  };
}

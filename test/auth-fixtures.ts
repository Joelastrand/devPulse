import type { DecodedIdToken } from "firebase-admin/auth";
import { vi } from "vitest";

/**
 * Shared authentication fixtures for feature tests.
 *
 * The production identity path reads the live Firebase Auth account on every request (`verifyIdToken` -> `loadAccount`).
 * Feature tests cannot reach Firebase, so the Admin Auth seam (`getAdminAuth`) is pointed at `testAdminAuth`, which
 * answers only for accounts a test has registered. An unregistered uid is "user not found", which the production code
 * refuses (`invalid_token`). Nothing here grants access by default:
 * - there is no catch-all account;
 * - the access policy in `src/features/auth/server/access-policy.ts` still runs on every verified identity;
 * - superadmin status still comes from the injected `isSuperadmin` or the registry, never from this file.
 */

export interface TestIdentity {
  readonly uid: string;
  readonly email: string;
  readonly emailVerified?: boolean;
  readonly disabled?: boolean;
}

interface RegisteredAccount {
  readonly uid: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly disabled: boolean;
}

const accounts = new Map<string, RegisteredAccount>();

/** Registers (or replaces) the live account for a uid. Call it when a test creates the identity it will use. */
export function registerTestAccount(identity: TestIdentity): RegisteredAccount {
  const account: RegisteredAccount = {
    uid: identity.uid,
    email: identity.email,
    emailVerified: identity.emailVerified !== false,
    disabled: identity.disabled === true,
  };
  accounts.set(identity.uid, account);
  return account;
}

/** Clears every registered account. Use in `beforeEach` when a file needs a clean registry. */
export function resetTestAccounts(): void {
  accounts.clear();
}

/**
 * The fake Admin Auth. Only `getUser` is meaningful: it returns a registered account or throws `auth/user-not-found`.
 * `verifyIdToken` is not used by feature tests, which inject a token verifier, so it refuses.
 */
export const testAdminAuth = {
  async getUser(uid: string) {
    const account = accounts.get(uid);
    if (account === undefined) {
      throw Object.assign(new Error(`no test account registered for uid ${uid}`), { code: "auth/user-not-found" });
    }
    return { ...account };
  },
  /** Looks an account up by e-mail (case-insensitive, as Firebase Auth does). Unregistered addresses are "not found". */
  async getUserByEmail(email: string) {
    const wanted = email.trim().toLowerCase();
    for (const account of accounts.values()) {
      if (account.email.toLowerCase() === wanted) return { ...account };
    }
    throw Object.assign(new Error(`no test account registered for ${email}`), { code: "auth/user-not-found" });
  },
  async verifyIdToken(): Promise<never> {
    throw new Error("feature tests inject a token verifier; verifyIdToken is not used here");
  },
};

/**
 * The token verifier a feature test injects for one identity. It registers the live account first, so the production
 * live-account read resolves to the same facts the token claims. The claims match the shape Firebase issues.
 */
export function verifierFor(identity: TestIdentity) {
  // Registration happens on each verification, not at construction: a later test may register the same uid differently,
  // and the live read must see the identity of the token being verified now.
  // The claim object carries the fields this codebase reads; the cast stands in for the full Admin SDK type in tests only.
  return vi.fn<(token: string) => Promise<DecodedIdToken>>(async (_token) => {
    registerTestAccount(identity);
    return {
      uid: identity.uid,
      email: identity.email,
      email_verified: identity.emailVerified !== false,
    } as unknown as DecodedIdToken;
  });
}

/**
 * Registers the live account behind a decoded-token claim object, and returns the claims unchanged. Use it where a test
 * builds claims inline; the account it registers is exactly what the token asserts, so the live read and the token agree.
 */
export function registerClaims<T extends { readonly uid: string; readonly email: string; readonly email_verified?: unknown }>(
  claims: T,
): T {
  registerTestAccount({ uid: claims.uid, email: claims.email, emailVerified: claims.email_verified === true });
  return claims;
}

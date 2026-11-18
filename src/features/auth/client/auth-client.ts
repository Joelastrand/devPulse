import {
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  reload,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { getFirebaseAuth } from "../../../lib/firebase/client";
import { isNveEmail } from "../domain/nve-email";

/**
 * The write seam this feature depends on, satisfied in production by the
 * Firebase client SDK and by an in-memory fake in tests — so tests never
 * need a real Firebase project (mirrors `PulseSurveyCollection`).
 */
export interface AuthGateway {
  createUser(email: string, password: string): Promise<void>;
  sendEmailVerification(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  /** Reloads the signed-in account from Firebase and reports its current verification flag. False when signed out. */
  reloadEmailVerified(): Promise<boolean>;
  signOut(): Promise<void>;
  /**
   * Reports the ID token and the Firebase account UID it belongs to, or `null` for both when signed out. The UID is a
   * client-side identity-change signal only; it is never an authorization input (the server verifies the token).
   */
  subscribeToIdToken(callback: IdTokenCallback): () => void;
}

/**
 * `account_changing` is emitted synchronously, before the new account's token is read, when Firebase reports a different
 * account than the last one delivered. It carries no token and no UID: its only job is to invalidate the previous
 * account's protected UI at once, instead of after the new token has loaded. It does not mean the new account is signed in.
 */
export type IdentitySignal = "account_changing";

export type IdTokenCallback = (token: string | null, uid: string | null, signal?: IdentitySignal) => void;

function getDefaultGateway(): AuthGateway {
  const auth = getFirebaseAuth();
  return {
    async createUser(email, password) {
      await createUserWithEmailAndPassword(auth, email, password);
    },
    async sendEmailVerification() {
      // Firebase sets `auth.currentUser` to the newly created account.
      if (auth.currentUser) {
        await sendEmailVerification(auth.currentUser);
      }
    },
    async signIn(email, password) {
      await signInWithEmailAndPassword(auth, email, password);
    },
    async reloadEmailVerified() {
      const user = auth.currentUser;
      if (!user) return false;
      // `reload` refreshes the cached flag after the person clicks the link in another tab.
      await reload(user);
      return user.emailVerified;
    },
    async signOut() {
      await firebaseSignOut(auth);
    },
    subscribeToIdToken(callback) {
      /** UID last delivered with a token. Used only to detect a real account change, never as authorization. */
      let deliveredUid: string | null = null;
      return onIdTokenChanged(auth, async (user) => {
        if (!user) {
          deliveredUid = null;
          callback(null, null);
          return;
        }

        const uid = user.uid;
        if (deliveredUid !== null && deliveredUid !== uid) {
          // Invalidate the previous account now. Waiting for `getIdToken()` below would leave its protected UI visible.
          callback(null, null, "account_changing");
        }
        let token: string | null;
        try {
          token = await user.getIdToken();
        } catch {
          token = null;
        }
        // The token read is asynchronous. If the Firebase account changed while it was pending, this result belongs to a
        // superseded account and is dropped: a later emission reports the current account. Without this check an
        // older account's token could be delivered last and be treated as the signed-in account.
        if (auth.currentUser?.uid !== uid) return;
        deliveredUid = token === null ? null : uid;
        callback(token, token === null ? null : uid);
      });
    },
  };
}

/**
 * `not_nve_email` is a client-side pre-check only: it stops an ordinary registration before any account exists. The server
 * enforces the same policy on every protected request, so this check is never the control on its own.
 */
export type SignUpResult = { ok: true } | { ok: false; error: "not_nve_email" | "sign_up_failed" };

export interface AuthActionDeps {
  gateway?: AuthGateway;
}

/** Creates an account for an NVE address and triggers Firebase's standard verification email. */
export async function signUp(
  email: string,
  password: string,
  deps: AuthActionDeps = {},
): Promise<SignUpResult> {
  if (!isNveEmail(email)) {
    return { ok: false, error: "not_nve_email" };
  }

  const gateway = deps.gateway ?? getDefaultGateway();

  try {
    await gateway.createUser(email, password);
    await gateway.sendEmailVerification();
    return { ok: true };
  } catch {
    return { ok: false, error: "sign_up_failed" };
  }
}

export type SignInResult =
  | { ok: true }
  | { ok: false; error: "invalid_credentials" }
  | { ok: false; error: "email_not_verified" };

/**
 * Signs in an existing account. An unverified account stays signed in, so the verification screen can resend the link
 * and offer a clean login after verification. Protected requests are refused on the server until the address is verified.
 */
export async function signIn(
  email: string,
  password: string,
  deps: AuthActionDeps = {},
): Promise<SignInResult> {
  const gateway = deps.gateway ?? getDefaultGateway();

  try {
    await gateway.signIn(email, password);
  } catch {
    return { ok: false, error: "invalid_credentials" };
  }

  try {
    if (!(await gateway.reloadEmailVerified())) {
      return { ok: false, error: "email_not_verified" };
    }
    return { ok: true };
  } catch {
    // The credentials were accepted but the verification state could not be read. Fail closed: treat as unverified.
    return { ok: false, error: "email_not_verified" };
  }
}

export type ResendVerificationResult = { ok: true } | { ok: false; error: "resend_failed" };

/**
 * Sends the verification link again to the currently signed-in account. Only the signed-in person can trigger it, and the
 * reply never says whether any other address exists. Abuse is limited by the client cooldown and by Firebase's own limits.
 */
export async function resendVerificationEmail(deps: AuthActionDeps = {}): Promise<ResendVerificationResult> {
  const gateway = deps.gateway ?? getDefaultGateway();

  try {
    await gateway.sendEmailVerification();
    return { ok: true };
  } catch {
    return { ok: false, error: "resend_failed" };
  }
}

export type SignOutResult = { ok: true } | { ok: false; error: "sign_out_failed" };

/**
 * Signs the current user out via the Firebase client SDK. `observeIdToken`
 * subscribers are notified of the resulting `null` token on their own —
 * this function does not (and must not) update any UI state directly
 * (docs/archive/features/product-ux-shell/SPEC.md — TASK-005).
 */
export async function signOut(deps: AuthActionDeps = {}): Promise<SignOutResult> {
  const gateway = deps.gateway ?? getDefaultGateway();

  try {
    await gateway.signOut();
    return { ok: true };
  } catch {
    return { ok: false, error: "sign_out_failed" };
  }
}

/**
 * Subscribes to the signed-in user's Firebase ID token, invoking `callback`
 * with the current token (or `null` when signed out) on every change,
 * including token refreshes. Returns an unsubscribe function.
 *
 * This is the only client-side seam that produces the ID token protected
 * requests (e.g. `GET /api/teams/[teamId]/results`) must send — the token
 * itself is never treated as authorization by the client, only forwarded
 * for the server to verify (`.claude/rules/security.md`).
 */
export function observeIdToken(
  callback: IdTokenCallback,
  deps: AuthActionDeps = {},
): () => void {
  const gateway = deps.gateway ?? getDefaultGateway();
  return gateway.subscribeToIdToken(callback);
}

import {
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { getFirebaseAuth } from "../../../lib/firebase/client";

/**
 * The write seam this feature depends on, satisfied in production by the
 * Firebase client SDK and by an in-memory fake in tests — so tests never
 * need a real Firebase project (mirrors `PulseSurveyCollection`).
 */
export interface AuthGateway {
  createUser(email: string, password: string): Promise<void>;
  sendEmailVerification(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  subscribeToIdToken(callback: (token: string | null) => void): () => void;
}

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
    subscribeToIdToken(callback) {
      return onIdTokenChanged(auth, async (user) => {
        if (!user) {
          callback(null);
          return;
        }

        try {
          callback(await user.getIdToken());
        } catch {
          callback(null);
        }
      });
    },
  };
}

export type SignUpResult = { ok: true } | { ok: false; error: "sign_up_failed" };

export interface AuthActionDeps {
  gateway?: AuthGateway;
}

/** Creates an account and triggers Firebase's standard verification email. */
export async function signUp(
  email: string,
  password: string,
  deps: AuthActionDeps = {},
): Promise<SignUpResult> {
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
  | { ok: false; error: "invalid_credentials" };

/**
 * Signs in an existing account. Does not require a verified email — email
 * verification only gates team resolution (`src/features/teams/`), not
 * sign-in itself.
 */
export async function signIn(
  email: string,
  password: string,
  deps: AuthActionDeps = {},
): Promise<SignInResult> {
  const gateway = deps.gateway ?? getDefaultGateway();

  try {
    await gateway.signIn(email, password);
    return { ok: true };
  } catch {
    return { ok: false, error: "invalid_credentials" };
  }
}

/**
 * Subscribes to the signed-in user's Firebase ID token, invoking `callback`
 * with the current token (or `null` when signed out) on every change,
 * including token refreshes. Returns an unsubscribe function.
 *
 * This is the only client-side seam that produces the ID token protected
 * requests (e.g. `GET /api/results`) must send — the token itself is never
 * treated as authorization by the client, only forwarded for the server to
 * verify (`.claude/rules/security.md`).
 */
export function observeIdToken(
  callback: (token: string | null) => void,
  deps: AuthActionDeps = {},
): () => void {
  const gateway = deps.gateway ?? getDefaultGateway();
  return gateway.subscribeToIdToken(callback);
}

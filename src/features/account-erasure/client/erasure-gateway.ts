import { signInWithEmailAndPassword, signOut as firebaseSignOut } from "firebase/auth";
import { getFirebaseAuth } from "../../../lib/firebase/client";
import type { ErasureClientGateway } from "./run-erasure-flow";

/**
 * Browser gateway for the erasure flow (TASK-039). The Firebase client SDK re-authenticates the signed-in account, and `fetch`
 * calls the endpoint with the current ID token. It is the only client module of this feature that touches Firebase, and it
 * logs nothing. Re-authentication uses the signed-in account's own e-mail, never a typed one, so the password proves the account
 * being erased (BR-3) and cannot switch the session to another account.
 */
export function createErasureClientGateway(): ErasureClientGateway {
  const auth = getFirebaseAuth();
  return {
    signedInEmail() {
      return auth.currentUser?.email ?? null;
    },
    async reauthenticate(password) {
      const email = auth.currentUser?.email;
      if (!email) throw new Error("no signed-in account");
      await signInWithEmailAndPassword(auth, email, password);
    },
    async idToken() {
      if (auth.currentUser === null) return null;
      return auth.currentUser.getIdToken();
    },
    async startOrResume(idToken, confirmation) {
      const response = await fetch("/api/me/erasure", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      const body: unknown = await response.json().catch(() => ({}));
      return { status: response.status, body };
    },
    async signOut() {
      await firebaseSignOut(auth);
    },
    wait(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
  };
}
